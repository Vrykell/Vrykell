import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { registerCloseFlush } from '@core/closeFlush';
import { registerEditorCloseGuard, type EditorCloseTarget } from '@core/editor';
import { useWorkspaceStore } from '@features/workspace/stores/workspace';
import { useNativeCloseGuard } from '../hooks/useNativeCloseGuard';
import { registerEditorChangeFlush } from '@ui/editor/code/pendingChanges';

const api = vi.hoisted(() => ({ handler: undefined as undefined | ((event: { preventDefault: () => void }) => void),
  close: vi.fn(async () => {}), stop: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ close: api.close,
  onCloseRequested: async (handler: typeof api.handler) => { api.handler = handler; return api.stop; } }) }));
const workspace = useWorkspaceStore.getState();
let release: (() => void) | undefined;
afterEach(() => { cleanup(); release?.(); release = undefined; useWorkspaceStore.setState(workspace, true); vi.clearAllMocks(); });

it('flushes persistence before a clean native close and unregisters its listener on unmount', async () => {
  const guard = vi.fn(() => false); release = registerEditorCloseGuard(guard);
  useWorkspaceStore.setState({ tabs: [] });
  const { unmount } = renderHook(useNativeCloseGuard);
  const preventDefault = vi.fn();
  act(() => api.handler?.({ preventDefault }));
  expect(guard).toHaveBeenCalledWith([], expect.any(Function));
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(api.close).not.toHaveBeenCalled();
  await act(async () => { await Promise.resolve(); });
  expect(api.close).toHaveBeenCalledOnce();
  await act(async () => {}); unmount();
  expect(api.stop).toHaveBeenCalledOnce();
});

it('flushes coalesced editor edits before asking the close guard', () => {
  const flush = vi.fn();
  const stop = registerEditorChangeFlush(flush);
  const guard = vi.fn(() => false); release = registerEditorCloseGuard(guard);
  useWorkspaceStore.setState({ tabs: [] });
  renderHook(useNativeCloseGuard);
  act(() => api.handler?.({ preventDefault: vi.fn() }));
  expect(flush).toHaveBeenCalledOnce();
  stop();
});

it('coalesces repeated close requests while persistence is still flushing', async () => {
  let releaseFlush!: () => void;
  const stopFlush = registerCloseFlush('test-flush', () => new Promise<void>(resolve => { releaseFlush = resolve; }));
  const stopEditor = registerEditorCloseGuard(vi.fn(() => false));
  useWorkspaceStore.setState({ tabs: [] });
  renderHook(useNativeCloseGuard);
  const preventDefault = vi.fn();
  act(() => api.handler?.({ preventDefault }));
  act(() => api.handler?.({ preventDefault }));
  expect(api.close).not.toHaveBeenCalled();
  await act(async () => { releaseFlush(); await Promise.resolve(); });
  expect(api.close).toHaveBeenCalledOnce();
  stopFlush();
  stopEditor();
});

it('preserves cancellation and permits the follow-up native close only after approval', async () => {
  const file = { path: '/repo/unsaved.ts' };
  useWorkspaceStore.setState({ tabs: [{ id: 'editor', kind: 'editor', title: 'Editor', files: [file], selected: file }] });
  let approve: (() => void) | undefined;
  const guard = vi.fn((_files: EditorCloseTarget, complete: () => void) => { approve = complete; return true; });
  release = registerEditorCloseGuard(guard);
  renderHook(useNativeCloseGuard);
  const preventDefault = vi.fn();
  act(() => api.handler?.({ preventDefault }));
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(api.close).not.toHaveBeenCalled();
  act(() => api.handler?.({ preventDefault }));
  expect(preventDefault).toHaveBeenCalledTimes(2);
  act(() => approve?.());
  await act(async () => { await Promise.resolve(); });
  expect(api.close).toHaveBeenCalledOnce();
  act(() => api.handler?.({ preventDefault }));
  expect(preventDefault).toHaveBeenCalledTimes(2);
  expect(guard).toHaveBeenCalledTimes(2);
});
