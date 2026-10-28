import { ptyWrite } from '@platform/pty';

/**
 * Longest ordinary input payload in UTF-16 code units. A write can block when the consumer stops
 * reading; completion means the system accepted bytes, not that the application consumed them.
 * Paste uses smaller guarded chunks so a foreground change can drop unsent text promptly.
 */
export const TERMINAL_INPUT_CHUNK_UNITS = 16 * 1024;

/** Interrupt key. Sending it drops whatever the session has queued but not written yet. */
const INTERRUPT = '\x03';

interface WriteJob {
  data: string;
  /** Offset of the next chunk inside `data`. */
  offset: number;
  resolve: () => void;
  reject: (error: unknown) => void;
  guard?: TerminalInputGuard;
}

export interface TerminalInputGuard { epoch: number; isCurrent: () => boolean }
const pasteScopes = new Map<string, { guard: TerminalInputGuard; writes: Promise<void>[] }>();

/** Keep the parser's synchronous paste encoding while binding all emitted writes to one owner. */
export async function writeTerminalPaste(sessionId: string, guard: TerminalInputGuard, emit: () => void): Promise<void> {
  const previous = pasteScopes.get(sessionId);
  const scope = { guard, writes: [] as Promise<void>[] };
  pasteScopes.set(sessionId, scope);
  try { emit(); }
  finally { if (previous) pasteScopes.set(sessionId, previous); else pasteScopes.delete(sessionId); }
  await Promise.all(scope.writes);
}

export class TerminalInputTargetChanged extends Error {
  constructor() { super('terminal input target changed'); }
}

interface SessionQueue {
  jobs: WriteJob[];
  draining: boolean;
}

/** One queue per session: writes of a session never overtake each other. */
const queues = new Map<string, SessionQueue>();

/**
 * Send terminal input to a session. Payloads longer than one chunk are split, writes of the same
 * session stay in order, and an interrupt drops the part that has not been sent yet. The returned
 * promise settles once this payload is written, or as soon as it was dropped on purpose.
 */
export function writeTerminalInput(sessionId: string, data: string): Promise<void> {
  if (!data) return Promise.resolve();
  // An interrupt leads the queue: the text typed after it must not wait for the rest of a paste.
  if (data === INTERRUPT) cancelTerminalInput(sessionId);
  const scope = pasteScopes.get(sessionId);
  const result = new Promise<void>((resolve, reject) => {
    const job: WriteJob = { data, offset: 0, resolve, reject, guard: scope?.guard };
    const queue = queues.get(sessionId) ?? { jobs: [], draining: false };
    queues.set(sessionId, queue);
    queue.jobs.push(job);
    if (!queue.draining) void drain(sessionId, queue);
  });
  scope?.writes.push(result);
  return result;
}

/**
 * Drop every write the session has queued but not sent. The chunk already handed to the PTY still
 * finishes; everything after it never arrives. A session that closes, or an interrupt, both come
 * here; the dropped callers settle as written because losing the remainder is the point.
 */
export function cancelTerminalInput(sessionId: string): void {
  const queue = queues.get(sessionId);
  if (!queue) return;
  for (const job of queue.jobs.splice(0)) job.resolve();
}

async function drain(sessionId: string, queue: SessionQueue): Promise<void> {
  queue.draining = true;
  try {
    while (queue.jobs.length > 0) {
      const job = queue.jobs[0]!;
      if (job.guard && !job.guard.isCurrent()) {
        queue.jobs.shift(); job.reject(new TerminalInputTargetChanged()); continue;
      }
      const end = chunkEnd(job.data, job.offset, job.guard ? 1024 : TERMINAL_INPUT_CHUNK_UNITS);
      const chunk = job.data.slice(job.offset, end);
      job.offset = end;
      try {
        if (job.guard) await ptyWrite(sessionId, chunk, job.guard.epoch);
        else await ptyWrite(sessionId, chunk);
      } catch (error) {
        // A session that is gone fails every remaining chunk: report once and stop.
        if (queue.jobs[0] === job) queue.jobs.shift();
        job.reject(error);
        failQueue(queue, error);
        return;
      }
      // A cancel may have dropped this job while the chunk was in flight; only the queue head
      // owns the completion, otherwise the shift would eat the interrupt queued behind it.
      if (job.offset >= job.data.length) {
        if (queue.jobs[0] === job) queue.jobs.shift();
        job.resolve();
      }
      // Let output and foreground completion invalidate the owner before another paste chunk.
      if (job.guard && queue.jobs[0] === job) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  } finally {
    queue.draining = false;
    if (queue.jobs.length === 0 && queues.get(sessionId) === queue) queues.delete(sessionId);
  }
}

function failQueue(queue: SessionQueue, error: unknown): void {
  for (const job of queue.jobs.splice(0)) job.reject(error);
}

/** End of the next chunk, never inside a surrogate pair: a write must not split a code point. */
function chunkEnd(data: string, offset: number, limit = TERMINAL_INPUT_CHUNK_UNITS): number {
  const end = Math.min(offset + limit, data.length);
  if (end >= data.length) return data.length;
  const before = data.charCodeAt(end - 1);
  const after = data.charCodeAt(end);
  // 0xD800-0xDBFF opens a surrogate pair, 0xDC00-0xDFFF closes one.
  if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) return end + 1;
  return end;
}
