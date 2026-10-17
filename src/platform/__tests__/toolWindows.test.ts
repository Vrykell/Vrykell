import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: { id: string; action?: unknown; ready?: boolean } }) => Promise<void>>(),
  events: new Map<string, (event: { payload?: unknown }) => void>(),
  create: vi.fn(), unminimize: vi.fn(), show: vi.fn(), focus: vi.fn(), emit: vi.fn(), stop: vi.fn(),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, handler: never) => { mock.handlers.set(name, handler); return mock.stop; }), emitTo: mock.emit,
}));
vi.mock('@tauri-apps/api/webviewWindow', () => ({ WebviewWindow: class {
  unminimize = mock.unminimize; show = mock.show; setFocus = mock.focus;
  constructor(label: string, options: unknown) { mock.create(label, options); }
  async once(name: string, handler: (event: { payload?: unknown }) => void) {
    mock.events.set(name, handler); if (name === 'tauri://created') queueMicrotask(() => handler({})); return mock.stop;
  }
} }));
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); mock.handlers.clear(); mock.events.clear(); mock.emit.mockResolvedValue(undefined); });
it('creates an unpinned child with minimum bounds and restores the same instance without replacing its input', async () => {
  const { openToolWindow } = await import('../toolWindows');
  const action = vi.fn().mockResolvedValue(undefined);
  await openToolWindow('composer', 'Write', { kind: 'command', input: { draft: 'original' } }, action);
  expect(mock.create).toHaveBeenCalledWith(expect.stringMatching(/^tool-/), expect.objectContaining({ width: 368, height: 488, alwaysOnTop: false, skipTaskbar: false, minWidth: 340, minHeight: 280 }));
  expect(mock.create.mock.calls[0]![1]).not.toHaveProperty('parent');
  await openToolWindow('composer', 'Write', { kind: 'command', input: { draft: 'replacement' } }, action);
  expect(mock.create).toHaveBeenCalledOnce(); expect(mock.unminimize).toHaveBeenCalledOnce(); expect(mock.show).toHaveBeenCalledOnce(); expect(mock.focus).toHaveBeenCalledOnce();
  const request = [...mock.handlers.values()][0]!;
  await request({ payload: { id: 'ready', ready: true } });
  expect(mock.emit).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), expect.objectContaining({ value: { kind: 'command', input: { draft: 'original' } } }));
});
it('rejects stale actions after their source unmounts and releases sessions when the native window closes', async () => {
  const { openToolWindow, detachToolWindow } = await import('../toolWindows');
  const action = vi.fn().mockResolvedValue(undefined);
  await openToolWindow('grouping', 'Groups', { kind: 'grouping', input: [] }, action);
  const request = [...mock.handlers.values()][0]!;
  await request({ payload: { id: 'apply', action: { type: 'apply' } } }); expect(action).toHaveBeenCalledOnce();
  detachToolWindow('grouping');
  await request({ payload: { id: 'stale', action: { type: 'apply' } } });
  expect(mock.emit).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), expect.objectContaining({ id: 'stale', ok: false }));
  expect(action).toHaveBeenCalledOnce();
  mock.events.get('tauri://destroyed')!({}); expect(mock.stop).toHaveBeenCalled();
  await openToolWindow('grouping', 'Groups', { kind: 'grouping', input: [] }, action); expect(mock.create).toHaveBeenCalledTimes(2);
});
it('cleans a failed creation and allows the entry point to create a fresh window', async () => {
  const { openToolWindow } = await import('../toolWindows');
  mock.create.mockImplementationOnce(() => { throw new Error('Window unavailable'); });
  await expect(openToolWindow('failed', 'Groups', { kind: 'grouping', input: [] }, vi.fn())).rejects.toThrow('Window unavailable');
  await openToolWindow('failed', 'Groups', { kind: 'grouping', input: [] }, vi.fn());
  expect(mock.create).toHaveBeenCalledTimes(2);
});
