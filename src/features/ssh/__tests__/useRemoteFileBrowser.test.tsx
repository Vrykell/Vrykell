import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { SshConnection } from '@features/ssh/services/api';
import { useRemoteFileBrowser } from '@features/ssh/hooks/useRemoteFileBrowser';
import { useRemotePathStore } from '@features/ssh/utils/remotePath';
import { useTerminalStore } from '@features/terminal';
import { useSessionStore } from '@features/workspace';
import { leaf } from '@features/workspace/model/windowLayout';

const sshMocks = vi.hoisted(() => ({
  sshFsList: vi.fn(),
  sshDownload: vi.fn(),
  sshRename: vi.fn(),
  sshMove: vi.fn(),
  sshUpload: vi.fn(),
  sshCopy: vi.fn(),
  sshStageDelete: vi.fn(),
  sshRestoreStaged: vi.fn(),
  sshPurgeStaged: vi.fn(),
  sshSweepUndo: vi.fn(),
}));

vi.mock('@features/ssh/services/api', () => sshMocks);
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@platform/pty', () => ({ ptyWrite: vi.fn() }));

describe('useRemoteFileBrowser', () => {
  const pathSnapshot = useRemotePathStore.getState();
  const terminalSnapshot = useTerminalStore.getState();
  const workspaceSnapshot = useSessionStore.getState();
  const conn: SshConnection = {
    id: 'ssh-1',
    name: '测试服务器',
    host: '127.0.0.1',
    user: 'root',
    authMethod: 'password',
  };

  beforeEach(() => {
    sshMocks.sshFsList.mockReset().mockResolvedValue({
      base: '/home/tester',
      entries: [{ name: 'src', path: '/home/tester/src', is_dir: true }],
    });
    sshMocks.sshRename.mockReset().mockResolvedValue(undefined);
    sshMocks.sshMove.mockReset().mockResolvedValue(undefined);
    sshMocks.sshCopy.mockReset().mockResolvedValue({ completed: [], errors: [] });
    sshMocks.sshStageDelete.mockReset().mockResolvedValue({ completed: [], errors: [] });
    sshMocks.sshRestoreStaged.mockReset().mockResolvedValue({ completed: [], errors: [] });
    sshMocks.sshPurgeStaged.mockReset().mockResolvedValue(undefined);
    sshMocks.sshSweepUndo.mockReset().mockResolvedValue(undefined);
    sshMocks.sshDownload.mockReset().mockResolvedValue('C:/Downloads/src');
    sshMocks.sshUpload.mockReset().mockResolvedValue(undefined);
    useRemotePathStore.setState({ path: {} });
  });

  afterEach(() => {
    useRemotePathStore.setState(pathSnapshot, true);
    useTerminalStore.setState(terminalSnapshot, true);
    useSessionStore.setState(workspaceSnapshot, true);
  });

  it('moves dropped entries into the target remote folder and skips same-level targets', async () => {
    const { result } = renderHook(() => useRemoteFileBrowser(conn));
    await waitFor(() => expect(result.current.path).toBe('/home/tester'));

    await act(async () => result.current.moveInto(
      [{ path: '/home/tester/src' }, { path: '/home/tester/docs' }],
      '/home/tester/archive',
    ));
    expect(sshMocks.sshMove).toHaveBeenCalledWith(conn.id, '/home/tester/src', '/home/tester/archive');
    expect(sshMocks.sshMove).toHaveBeenCalledWith(conn.id, '/home/tester/docs', '/home/tester/archive');

    // 目标与源同级：无操作，不发请求
    sshMocks.sshMove.mockClear();
    await act(async () => result.current.moveInto([{ path: '/home/tester/src' }], '/home/tester'));
    expect(sshMocks.sshMove).not.toHaveBeenCalled();
  });

  it('downloads entries before a system drag and returns the local paths', async () => {
    sshMocks.sshDownload.mockResolvedValueOnce('C:/Downloads/a').mockResolvedValueOnce('C:/Downloads/b');
    const { result } = renderHook(() => useRemoteFileBrowser(conn));
    await waitFor(() => expect(result.current.path).toBe('/home/tester'));

    let locals: string[] | null = null;
    await act(async () => {
      locals = await result.current.downloadForDrag([{ path: '/home/tester/a' }, { path: '/home/tester/b' }]);
    });
    expect(locals).toEqual(['C:/Downloads/a', 'C:/Downloads/b']);
    expect(sshMocks.sshDownload).toHaveBeenCalledWith(conn.id, '/home/tester/a');
  });

  it('keeps selection and restores the previous view when going back', async () => {
    useRemotePathStore.setState({ path: { [conn.id]: '/home/tester' } });
    const folder = { name: 'src', path: '/home/tester/src', is_dir: true };
    sshMocks.sshFsList.mockImplementation((_id: string, target?: string) => Promise.resolve(
      target === folder.path
        ? { base: folder.path, entries: [{ name: 'main.ts', path: '/home/tester/src/main.ts', is_dir: false }] }
        : { base: '/home/tester', entries: [folder] },
    ));
    const { result } = renderHook(() => useRemoteFileBrowser(conn));
    await waitFor(() => expect(result.current.entries[0]?.name).toBe('src'));

    act(() => result.current.selectOnly(folder.path));
    expect(result.current.canGoBack).toBe(false);

    act(() => result.current.navigate(folder.path));
    await waitFor(() => expect(result.current.entries[0]?.name).toBe('main.ts'));
    expect(result.current.selection.size).toBe(0);
    expect(result.current.canGoBack).toBe(true);

    act(() => result.current.goBack());
    await waitFor(() => expect(result.current.entries[0]?.name).toBe('src'));
    expect(result.current.selection.has(folder.path)).toBe(true);
    expect(result.current.anchorPath).toBe(folder.path);
    expect(result.current.canGoBack).toBe(false);
  });

  it('expands remote folders lazily through the child cache', async () => {
    useRemotePathStore.setState({ path: { [conn.id]: '/home/tester' } });
    const folder = { name: 'src', path: '/home/tester/src', is_dir: true };
    const child = { name: 'main.ts', path: '/home/tester/src/main.ts', is_dir: false };
    sshMocks.sshFsList.mockImplementation((_id: string, target?: string) => Promise.resolve(
      target === folder.path ? { base: folder.path, entries: [child] } : { base: '/home/tester', entries: [folder] },
    ));
    const { result } = renderHook(() => useRemoteFileBrowser(conn));
    await waitFor(() => expect(result.current.entries).toEqual([folder]));

    act(() => result.current.toggleExpand(folder));
    await waitFor(() => expect(result.current.childCache[folder.path]).toEqual([child]));
    expect(result.current.expandedSet.has(folder.path)).toBe(true);

    act(() => result.current.toggleExpand(folder));
    expect(result.current.expandedSet.has(folder.path)).toBe(false);
  });

  it('stages deletes for undo and restores them from the history stack', async () => {
    useRemotePathStore.setState({ path: { [conn.id]: '/home/tester' } });
    const entry = { name: 'old.txt', path: '/home/tester/old.txt', is_dir: false };
    const staged = { from: entry.path, to: '/home/tester/.vrykell/undo/u-old.txt' };
    sshMocks.sshStageDelete.mockResolvedValue({ completed: [staged], errors: [] });
    const { result } = renderHook(() => useRemoteFileBrowser(conn));
    await waitFor(() => expect(result.current.path).toBe('/home/tester'));

    act(() => {
      result.current.buildMenuItems(entry).find((item) => item.label === '删除')!.onClick();
    });
    expect(result.current.confirm).toEqual({ kind: 'delete', entries: [entry] });
    await act(async () => { result.current.confirmAction(); });
    await waitFor(() => expect(sshMocks.sshStageDelete).toHaveBeenCalledWith(conn.id, [entry.path]));
    expect(result.current.undo).toMatchObject({ kind: 'delete', label: '删除' });
    expect(result.current.undoCount).toBe(1);

    sshMocks.sshRestoreStaged.mockResolvedValue({ completed: [staged], errors: [] });
    await act(async () => { await result.current.runUndo(); });
    expect(sshMocks.sshRestoreStaged).toHaveBeenCalledWith(conn.id, [staged]);
    expect(result.current.undoCount).toBe(0);
  });

  it('pastes a copy into a folder row and a cut into the current directory', async () => {
    useRemotePathStore.setState({ path: { [conn.id]: '/home/tester' } });
    const entry = { name: 'a.txt', path: '/home/tester/a.txt', is_dir: false };
    const folder = { name: 'src', path: '/home/tester/src', is_dir: true };
    const nested = { name: 'b.txt', path: '/home/tester/src/b.txt', is_dir: false };
    sshMocks.sshCopy.mockResolvedValue({ completed: [{ from: entry.path, to: '/home/tester/src/a.txt' }], errors: [] });
    const { result } = renderHook(() => useRemoteFileBrowser(conn));
    await waitFor(() => expect(result.current.path).toBe('/home/tester'));

    act(() => result.current.copySelection([entry]));
    act(() => {
      result.current.buildMenuItems(folder).find((item) => item.label === '粘贴到「src」')!.onClick();
    });
    await waitFor(() => expect(sshMocks.sshCopy).toHaveBeenCalledWith(conn.id, [entry.path], folder.path));

    // 剪切粘贴 = 移动，目标为当前目录
    act(() => result.current.cutSelection([nested]));
    await act(async () => { await result.current.pasteClipboard(); });
    expect(sshMocks.sshMove).toHaveBeenCalledWith(conn.id, nested.path, '/home/tester');
    expect(result.current.undo).toMatchObject({ kind: 'move' });
  });

  it('retries an initially untrusted directory after SSH startup', async () => {
    useSessionStore.setState({ tabs: [{ id: 'tab', kind: 'session', title: 'ssh', layout: leaf({ id: 'pane', kind: 'ssh', ssh: { name: conn.name, host: conn.host, connectionId: conn.id } }) }], activeId: 'tab' });
    useTerminalStore.setState({ sessions: {} });
    sshMocks.sshFsList.mockRejectedValueOnce(new Error('HOST_KEY_UNKNOWN:SHA256:key'));
    const { result } = renderHook(() => useRemoteFileBrowser(conn));
    await waitFor(() => expect(result.current.error).toContain('HOST_KEY_UNKNOWN'));
    act(() => useTerminalStore.setState({ sessions: { pane: 'session' } }));
    await waitFor(() => expect(result.current.entries[0]?.name).toBe('src'));
    expect(result.current.error).toBeNull();
  });

  it('loads the remote home directory and normalizes the stored base path', async () => {
    const { result } = renderHook(() => useRemoteFileBrowser(conn));

    await waitFor(() => expect(result.current.path).toBe('/home/tester'));
    expect(result.current.entries[0]?.path).toBe('/home/tester/src');
    expect(sshMocks.sshFsList).toHaveBeenCalledWith(conn.id, undefined);
  });
  it('does not connect a hidden file panel and starts loading when it is opened', async () => {
    const { result, rerender } = renderHook(({ enabled }) => useRemoteFileBrowser(conn, enabled), { initialProps: { enabled: false } });
    expect(sshMocks.sshFsList).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.entries[0]?.name).toBe('src'));
  });

  it('keeps rename confirmation and refreshes after the remote mutation', async () => {
    useRemotePathStore.setState({ path: { [conn.id]: '/home/tester' } });
    const { result } = renderHook(() => useRemoteFileBrowser(conn));
    const entry = { name: 'old.txt', path: '/home/tester/old.txt', is_dir: false };

    act(() => result.current.requestRename(entry, '  new.txt '));
    expect(result.current.confirm).toEqual({ kind: 'rename', entry, newName: 'new.txt' });
    act(() => result.current.confirmAction());

    await waitFor(() => expect(sshMocks.sshRename).toHaveBeenCalledWith(conn.id, entry.path, 'new.txt'));
    expect(result.current.confirm).toBeNull();
    expect(sshMocks.sshFsList).toHaveBeenCalledWith(conn.id, '/home/tester');
  });
});
