import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushBeforeClose } from '@core/closeFlush';
import type { ChatMessage } from '@features/chat';
import { useHarnessStore } from '../stores/harness';
import {
  harnessTranscriptTitle, loadHarnessTranscript, parseStoredMessages, saveHarnessTranscript, serializeRetainedMessages,
} from '../services/harnessTranscripts';
import { deleteHarnessTranscriptCopy, flushHarnessTranscripts, startHarnessTranscriptRuntime } from '../services/harnessTranscriptRuntime';

interface SavedTranscript {
  harness: string; sessionId: string; cwd: string; title: string;
  createdAt: number; updatedAt: number; pending: boolean; messages: string;
}

const api = vi.hoisted(() => ({
  acpTranscriptSave: vi.fn(async (_input: SavedTranscript) => undefined),
  acpTranscriptGet: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
  acpTranscriptList: vi.fn(async () => []),
  acpTranscriptDelete: vi.fn(async () => undefined),
}));
vi.mock('@platform/api/acp', async original => ({ ...await original<typeof import('@platform/api/acp')>(), ...api }));

const message = (patch: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm', role: 'user', content: 'Fix the build', createdAt: 1, ...patch,
});

beforeEach(() => {
  vi.clearAllMocks();
  useHarnessStore.setState({ byTab: {} });
  localStorage.clear();
});
afterEach(() => { vi.useRealTimers(); });

describe('retained harness transcripts', () => {
  it('names the history row after the first question and falls back to the agent', () => {
    expect(harnessTranscriptTitle([message(), message({ id: 'a', role: 'assistant', content: 'Done' })], 'Agent')).toBe('Fix the build');
    expect(harnessTranscriptTitle([], 'Agent')).toBe('Agent');
    expect(Array.from(harnessTranscriptTitle([message({ content: '中'.repeat(130) })], 'Agent'))).toHaveLength(120);
  });

  it('validates stored messages and drops reasoning before saving', async () => {
    expect(parseStoredMessages('not json')).toEqual([]);
    expect(parseStoredMessages(JSON.stringify([
      { id: 'q', role: 'user', content: 'Question', createdAt: 1 },
      { id: '', role: 'user', content: 'Broken', createdAt: 2 },
      { id: 'a', role: 'assistant', content: 'Answer', createdAt: 3, reasoning: 'secret', parts: [{ kind: 'text', text: 'Answer' }] },
    ]))).toEqual([
      { id: 'q', role: 'user', content: 'Question', createdAt: 1 },
      { id: 'a', role: 'assistant', content: 'Answer', createdAt: 3, parts: [{ kind: 'text', text: 'Answer' }] },
    ]);

    await saveHarnessTranscript({
      harness: 'Agent', sessionId: 'durable', cwd: '/work', title: 'Fix the build',
      createdAt: 1, updatedAt: 2, pending: false, messages: [message({ reasoning: 'private thought' })],
    });
    const request = api.acpTranscriptSave.mock.calls[0]![0];
    expect(JSON.parse(request.messages)).toEqual([message()]);
    expect(request).toMatchObject({ harness: 'Agent', sessionId: 'durable', title: 'Fix the build' });
  });

  it('loads a retained transcript and tolerates a missing record', async () => {
    api.acpTranscriptGet.mockResolvedValueOnce({
      harness: 'Agent', sessionId: 'durable', cwd: '/work', title: 'Fix the build',
      createdAt: 1, updatedAt: 2, pending: false,
      messages: JSON.stringify([message()]),
    });
    await expect(loadHarnessTranscript('Agent', 'durable')).resolves.toMatchObject({ title: 'Fix the build', messages: [message()] });
    await expect(loadHarnessTranscript('Agent', 'missing')).resolves.toBeNull();
  });

  it('keeps the newest messages inside the local byte budget', () => {
    const old = message({ id: 'old', content: 'o'.repeat(160) });
    const recent = message({ id: 'recent', content: 'r'.repeat(160) });
    const json = serializeRetainedMessages([old, recent], 250);
    expect(json).not.toBeNull();
    expect(JSON.parse(json!).map((entry: ChatMessage) => entry.id)).toEqual(['recent']);
    expect(serializeRetainedMessages([message({ content: 'x'.repeat(2000) })], 20)).toBeNull();
  });

  it('restores the execution environment and terminal references', () => {
    const [restored] = parseStoredMessages(JSON.stringify([{
      id: 'q', role: 'user', content: 'Run', createdAt: 1,
      environment: { paneId: 'pane', label: 'Local', kind: 'local', cwd: '/repo' },
      references: [{ id: 'ref', paneId: 'pane', label: 'Shell', command: 'ls', output: 'a.txt', createdAt: 1 }],
    }]));
    expect(restored).toMatchObject({
      environment: { paneId: 'pane', label: 'Local', kind: 'local', cwd: '/repo' },
      references: [{ id: 'ref', paneId: 'pane', label: 'Shell', command: 'ls', output: 'a.txt' }],
    });
  });
});

describe('harness transcript runtime', () => {
  const session = (patch: Record<string, unknown> = {}) => ({
    harness: 'Agent', sessionId: 'live', resumeSessionId: 'durable', transcriptSessionId: 'durable',
    cwd: '/work', messages: [message()], pending: true, stopping: false,
    agent: null, modes: null, models: null, configOptions: null, plan: [], context: null, commands: [],
    permission: null, permissionGeneration: 0, opening: false, error: null, note: null,
    ...patch,
  });

  it('coalesces streamed updates and flushes the latest state', async () => {
    vi.useFakeTimers();
    const stop = startHarnessTranscriptRuntime();
    useHarnessStore.setState({ byTab: { tab: session() as never } });
    expect(api.acpTranscriptSave).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(api.acpTranscriptSave).toHaveBeenCalledOnce();
    expect(api.acpTranscriptSave.mock.calls[0]![0]).toMatchObject({ sessionId: 'durable', pending: true });

    useHarnessStore.setState({ byTab: { tab: session({ messages: [message({ content: 'Fix the build now' })], pending: false }) as never } });
    await flushHarnessTranscripts();
    expect(api.acpTranscriptSave).toHaveBeenCalledTimes(2);
    expect(JSON.parse(api.acpTranscriptSave.mock.calls[1]![0].messages)[0].content).toBe('Fix the build now');
    stop();
  });

  it('saves the final snapshot when a tab disappears', async () => {
    const stop = startHarnessTranscriptRuntime();
    useHarnessStore.setState({ byTab: { tab: session() as never } });
    useHarnessStore.setState({ byTab: {} });
    await flushHarnessTranscripts();
    expect(api.acpTranscriptSave).toHaveBeenCalledOnce();
    expect(api.acpTranscriptSave.mock.calls[0]![0]).toMatchObject({ sessionId: 'durable', pending: true });
    stop();
  });

  it('retains a session that was already open when the runtime starts', async () => {
    useHarnessStore.setState({ byTab: { tab: session({ transcriptSessionId: 'already-open', resumeSessionId: 'already-open' }) as never } });
    const stop = startHarnessTranscriptRuntime();
    await flushHarnessTranscripts();
    expect(api.acpTranscriptSave).toHaveBeenCalledOnce();
    stop();
  });

  it('registers its flush with the native close path', async () => {
    const stop = startHarnessTranscriptRuntime();
    useHarnessStore.setState({ byTab: { tab: session({ transcriptSessionId: 'close-flush', resumeSessionId: 'close-flush' }) as never } });
    await flushBeforeClose();
    expect(api.acpTranscriptSave).toHaveBeenCalledOnce();
    stop();
  });

  it('checkpoints a continuously streaming turn without waiting for a quiet period', async () => {
    vi.useFakeTimers();
    const stop = startHarnessTranscriptRuntime();
    useHarnessStore.setState({ byTab: { tab: session({ transcriptSessionId: 'streaming', resumeSessionId: 'streaming' }) as never } });
    await vi.advanceTimersByTimeAsync(300);
    expect(api.acpTranscriptSave).toHaveBeenCalledOnce();
    for (let index = 0; index < 10; index += 1) {
      useHarnessStore.setState({ byTab: { tab: session({ transcriptSessionId: 'streaming', resumeSessionId: 'streaming', messages: [message({ content: `chunk ${index}` })] }) as never } });
      await vi.advanceTimersByTimeAsync(250);
    }
    expect(api.acpTranscriptSave.mock.calls.length).toBeGreaterThanOrEqual(2);
    stop();
  });

  it('forgets its write signature when a local copy is deleted', async () => {
    vi.useFakeTimers();
    const stop = startHarnessTranscriptRuntime();
    const retained = session({ transcriptSessionId: 'recreate', resumeSessionId: 'recreate' });
    useHarnessStore.setState({ byTab: { tab: retained as never } });
    await vi.advanceTimersByTimeAsync(300);
    expect(api.acpTranscriptSave).toHaveBeenCalledOnce();
    await deleteHarnessTranscriptCopy('Agent', 'recreate');
    expect(api.acpTranscriptDelete).toHaveBeenCalledWith('Agent', 'recreate');

    useHarnessStore.setState({ byTab: {} });
    useHarnessStore.setState({ byTab: { tab: retained as never } });
    await vi.advanceTimersByTimeAsync(300);
    expect(api.acpTranscriptSave).toHaveBeenCalledTimes(2);
    stop();
  });

  it('does not persist a session whose only content is reasoning', async () => {
    const stop = startHarnessTranscriptRuntime();
    useHarnessStore.setState({
      byTab: { tab: session({ transcriptSessionId: 'thinking', resumeSessionId: 'thinking', messages: [message({ content: '', reasoning: 'private thought' })] }) as never },
    });
    await flushHarnessTranscripts();
    expect(api.acpTranscriptSave).not.toHaveBeenCalled();
    stop();
  });

  it('does not persist an empty session or one without a durable identity', async () => {
    const stop = startHarnessTranscriptRuntime();
    useHarnessStore.setState({ byTab: { empty: session({ messages: [], pending: false, resumeSessionId: undefined, transcriptSessionId: undefined }) as never } });
    await flushHarnessTranscripts();
    expect(api.acpTranscriptSave).not.toHaveBeenCalled();
    stop();
  });
});
