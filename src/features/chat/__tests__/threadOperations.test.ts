import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setDefaultStream, useChatStore, type StreamFn } from '../stores/chat';
import { delegateAnalysis, useChildTasks } from '../services/threadOperations';
import { agentCatalog } from '../model/agentCatalog';
import { captureTurn, useTurnCheckpoints, restoreTurn } from '../services/turnCheckpoints';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@platform/diagnostics', () => ({ invoke, diagnostic: vi.fn() }));
const parent = { driver: 'builtin', id: 'parent' } as const;
beforeEach(() => {
  invoke.mockReset().mockResolvedValue(undefined);
  useChildTasks.setState({ tasks: [] });
  useChatStore.setState({ byTab: {}, conversations: [], sendingTabs: [] });
});
afterEach(() => setDefaultStream(async () => {}));

it('distinguishes configured instances from a built-in agent with the same display label', () => {
  const [local] = agentCatalog([]);
  const entries = agentCatalog([{ name: local.label, command: 'test', args: [], env: {}, cwd: '', enabled: true }]);
  expect(entries.map((e) => e.id)).toEqual(['builtin', `acp:${local.label}`]);
});

it('runs delegated analysis in a separate thread and delivers its own result', async () => {
  const stream: StreamFn = async (history, chunk, ctx) => {
    expect(ctx?.analysisOnly).toBe(true);
    expect(ctx?.handlers?.delegateAnalysis).toBeUndefined();
    expect(ctx?.paneId).toBeNull();
    expect(history.map((m) => m.content)).toEqual(['Review the outline']);
    chunk('Independent answer');
  };
  setDefaultStream(stream);
  await expect(delegateAnalysis(parent, 'q', 'Review the outline', new AbortController().signal)).resolves.toBe('Independent answer');
  const [task] = useChildTasks.getState().tasks;
  expect(task).toMatchObject({ status: 'completed', parent: 'chat:parent', question: 'q' });
  expect(task.thread.id).not.toBe(parent.id);
  expect(task.answerId).toBeTruthy();
});

it('stops the child stream when its parent cancels', async () => {
  let start!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  setDefaultStream(async (_history, _chunk, ctx) => {
    start();
    await new Promise<void>((resolve) => ctx?.signal?.addEventListener('abort', () => resolve(), { once: true }));
  });
  const controller = new AbortController();
  const result = delegateAnalysis(parent, 'q', 'Wait for input', controller.signal);
  await started;
  controller.abort();
  await expect(result).rejects.toThrow();
  expect(useChildTasks.getState().tasks[0].status).toBe('stopped');
  expect(useChatStore.getState().sendingTabs).toEqual([]);
});

it('retains the file preview on a restore conflict and consumes it after a successful retry', async () => {
  invoke
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(['src/file.ts'])
    .mockRejectedValueOnce(new Error('conflict'))
    .mockResolvedValueOnce(undefined);
  const checkpoint = captureTurn('q', '/workspace');
  await Promise.all([checkpoint.finish(), checkpoint.finish()]);
  await expect(restoreTurn('q')).rejects.toThrow('conflict');
  expect(useTurnCheckpoints.getState().byQuestion.q.files).toEqual(['src/file.ts']);
  await restoreTurn('q');
  expect(useTurnCheckpoints.getState().byQuestion.q).toBeUndefined();
  expect(invoke).toHaveBeenCalledTimes(4);
});
