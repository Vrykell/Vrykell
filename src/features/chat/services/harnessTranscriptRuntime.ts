/**
 * harnessTranscriptRuntime — writes the visible ACP transcript to its local copy.
 *
 * Streaming chunks arrive far faster than a database write should run, so each tab is coalesced:
 * one save follows the latest state after a short quiet period, and a native close flushes the same
 * state before the window disappears. The subscription lives at the workspace shell, not inside an
 * ACP page, so a turn keeps being retained while its tab is hidden.
 */
import { registerCloseFlush } from '@core/closeFlush';
import { hasChatContent } from '@features/chat/model/chatContent';
import { useHarnessStore, type HarnessSession } from '@features/chat/stores/harness';
import { terminalDebug } from '@features/terminal/services/terminalDebug';
import {
  deleteHarnessTranscript, harnessTranscriptTitle, saveHarnessTranscript, type RetainedHarnessTranscript,
} from './harnessTranscripts';

const SAVE_DELAY_MS = 300;
/** A continuously streaming turn still checkpoints at this interval, so a crash cannot lose it all. */
const MAX_SAVE_WAIT_MS = 2000;
type Snapshot = Omit<RetainedHarnessTranscript, 'messages'> & { messages: HarnessSession['messages'] };

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const firstScheduledAt = new Map<string, number>();
const snapshots = new Map<string, Snapshot>();
const queues = new Map<string, Promise<void>>();
const signatures = new Map<string, string>();
let stopRuntime: (() => void) | null = null;

function transcriptId(session: HarnessSession): string | undefined {
  return session.transcriptSessionId ?? session.resumeSessionId;
}

/** Reasoning is stripped before saving, so it must not be the only reason a row exists. */
function hasPersistableContent(message: HarnessSession['messages'][number]): boolean {
  const copy = { ...message };
  delete copy.reasoning;
  return hasChatContent(copy);
}

function snapshotOf(session: HarnessSession): Snapshot | null {
  const sessionId = transcriptId(session);
  if (!sessionId || !session.messages.some(hasPersistableContent)) return null;
  const first = session.messages[0]?.createdAt;
  return {
    harness: session.harness,
    sessionId,
    cwd: session.cwd,
    title: harnessTranscriptTitle(session.messages, session.harness),
    createdAt: Number.isFinite(first) ? first! : Date.now(),
    updatedAt: Date.now(),
    pending: session.pending || !!session.stopping,
    messages: session.messages,
  };
}

function signatureOf(snapshot: Snapshot): string {
  const messages = snapshot.messages.map(message => {
    const copy = { ...message };
    delete copy.reasoning;
    return copy;
  });
  return JSON.stringify([snapshot.harness, snapshot.sessionId, snapshot.cwd, snapshot.title, snapshot.pending, messages]);
}

function keyOf(snapshot: Snapshot): string {
  return `${snapshot.harness}\u0000${snapshot.sessionId}`;
}

function enqueue(snapshot: Snapshot): Promise<void> {
  const key = keyOf(snapshot);
  const signature = signatureOf(snapshot);
  if (signatures.get(key) === signature) return queues.get(key) ?? Promise.resolve();
  const previous = queues.get(key) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    await saveHarnessTranscript(snapshot);
    signatures.set(key, signature);
  }).catch((error: unknown) => {
    terminalDebug('harness-transcript-save-failed', { harness: snapshot.harness, sessionId: snapshot.sessionId, reason: String(error).slice(0, 200) });
  });
  queues.set(key, operation);
  void operation.finally(() => { if (queues.get(key) === operation) queues.delete(key); }).catch(() => {});
  return operation;
}

function schedule(tabId: string) {
  const session = useHarnessStore.getState().byTab[tabId];
  const snapshot = session ? snapshotOf(session) : null;
  if (!snapshot) {
    snapshots.delete(tabId);
    firstScheduledAt.delete(tabId);
    const pending = timers.get(tabId);
    if (pending) clearTimeout(pending);
    timers.delete(tabId);
    return;
  }
  snapshots.set(tabId, snapshot);
  const scheduledAt = firstScheduledAt.get(tabId) ?? Date.now();
  firstScheduledAt.set(tabId, scheduledAt);
  const existing = timers.get(tabId);
  if (existing) clearTimeout(existing);
  const delay = Math.max(0, Math.min(SAVE_DELAY_MS, scheduledAt + MAX_SAVE_WAIT_MS - Date.now()));
  timers.set(tabId, setTimeout(() => {
    timers.delete(tabId);
    firstScheduledAt.delete(tabId);
    const pending = snapshots.get(tabId);
    if (pending) void enqueue(pending);
  }, delay));
}

/**
 * Remove one local copy and forget its write signature. Without forgetting the signature a later
 * reopen of the same unchanged transcript would look already saved and never recreate the row.
 */
export async function deleteHarnessTranscriptCopy(harness: string, sessionId: string): Promise<void> {
  const key = `${harness}\u0000${sessionId}`;
  for (const [tabId, snapshot] of [...snapshots]) {
    if (snapshot.harness !== harness || snapshot.sessionId !== sessionId) continue;
    const timer = timers.get(tabId);
    if (timer) clearTimeout(timer);
    timers.delete(tabId);
    firstScheduledAt.delete(tabId);
    snapshots.delete(tabId);
  }
  await queues.get(key)?.catch(() => undefined);
  signatures.delete(key);
  await deleteHarnessTranscript(harness, sessionId);
}

/** Save everything currently known, including a tab that has just been closed. */
export async function flushHarnessTranscripts(): Promise<void> {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  firstScheduledAt.clear();
  for (const tabId of [...snapshots.keys()]) {
    if (!useHarnessStore.getState().byTab[tabId]) continue;
    const live = snapshotOf(useHarnessStore.getState().byTab[tabId]!);
    if (live) snapshots.set(tabId, live);
  }
  await Promise.all([...snapshots.values()].map(snapshot => enqueue(snapshot)));
  await Promise.all([...queues.values()]);
}

/**
 * Start the single application-wide transcript writer. Starting it twice returns the same
 * disposer, so a React remount cannot install a second subscription.
 */
export function startHarnessTranscriptRuntime(): () => void {
  if (stopRuntime) return stopRuntime;
  // The workspace shell can start after a tab has already opened; retain that state too.
  for (const tabId of Object.keys(useHarnessStore.getState().byTab)) schedule(tabId);
  const unsubscribe = useHarnessStore.subscribe((state, previous) => {
    for (const [tabId, session] of Object.entries(state.byTab)) {
      if (session !== previous.byTab[tabId]) schedule(tabId);
    }
    for (const [tabId, session] of Object.entries(previous.byTab)) {
      if (state.byTab[tabId]) continue;
      const timer = timers.get(tabId);
      if (timer) { clearTimeout(timer); timers.delete(tabId); }
      firstScheduledAt.delete(tabId);
      const snapshot = snapshotOf(session);
      snapshots.delete(tabId);
      if (snapshot) void enqueue(snapshot);
    }
  });
  const unregister = registerCloseFlush('acp-transcripts', flushHarnessTranscripts);
  stopRuntime = () => {
    unsubscribe();
    unregister();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    firstScheduledAt.clear();
    snapshots.clear();
    stopRuntime = null;
  };
  return stopRuntime;
}
