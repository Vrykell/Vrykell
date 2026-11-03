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
  /** An abortable job owns its payload; batching it with later input would hide that ownership. */
  signal?: AbortSignal;
  cancelled?: boolean;
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
export function writeTerminalInput(sessionId: string, data: string, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
  if (!data) return Promise.resolve();
  // An interrupt leads the queue: the text typed after it must not wait for the rest of a paste.
  if (data === INTERRUPT) cancelTerminalInput(sessionId);
  const scope = pasteScopes.get(sessionId);
  const result = new Promise<void>((resolve, reject) => {
    const queue = queues.get(sessionId) ?? { jobs: [], draining: false };
    const abort = () => {
      job.cancelled = true;
      const index = queue.jobs.indexOf(job);
      if (index >= 0) queue.jobs.splice(index, 1);
      job.reject(new DOMException('The operation was aborted.', 'AbortError'));
    };
    const finish = (settle: () => void) => { signal?.removeEventListener('abort', abort); settle(); };
    const job: WriteJob = { data, offset: 0, resolve: () => finish(resolve), reject: error => finish(() => reject(error)), guard: scope?.guard, signal };
    signal?.addEventListener('abort', abort, { once: true });
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
      // Fast typing queues several short jobs behind one another. Sending them as one write
      // removes the per-key IPC round trip without changing the order the shell sees.
      const batch = takeBatch(queue);
      if (batch) {
        try {
          await ptyWrite(sessionId, batch.data);
        } catch (error) {
          const head = batch.jobs[0]!;
          if (queue.jobs[0] === head) queue.jobs.shift();
          head.reject(error);
          failQueue(queue, error);
          return;
        }
        for (const job of batch.jobs) {
          // A cancel may have dropped the job while the write was in flight.
          const index = queue.jobs.indexOf(job);
          if (index >= 0) queue.jobs.splice(index, 1);
          job.resolve();
        }
        continue;
      }
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
        if (job.cancelled) continue;
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

/**
 * Collect the head and the plain jobs behind it into one payload. Only complete jobs are
 * batched: a job that needs another chunk keeps the existing single-job path, and guarded
 * paste jobs, abortable jobs and the interrupt stay alone so their ownership rules hold.
 */
function takeBatch(queue: SessionQueue): { jobs: WriteJob[]; data: string } | null {
  // Batching only applies when another job is already waiting; a single job keeps the
  // chunked path without copying its payload first.
  if (queue.jobs.length < 2) return null;
  const head = queue.jobs[0];
  if (!head || head.guard || head.signal || head.data === INTERRUPT) return null;
  // A payload larger than one chunk must keep its chunked, sequential writes.
  if (head.data.length - head.offset > TERMINAL_INPUT_CHUNK_UNITS) return null;
  let data = head.data.slice(head.offset);
  const jobs = [head];
  for (let index = 1; index < queue.jobs.length; index++) {
    const next = queue.jobs[index]!;
    if (next.guard || next.signal || next.data === INTERRUPT) break;
    const rest = next.data.slice(next.offset);
    if (data.length + rest.length > TERMINAL_INPUT_CHUNK_UNITS) break;
    data += rest;
    jobs.push(next);
  }
  return jobs.length > 1 ? { jobs, data } : null;
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
