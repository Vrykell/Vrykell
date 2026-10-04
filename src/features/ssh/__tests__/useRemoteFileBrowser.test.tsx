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
  sshDelete: vi.fn(),
  sshUpload: vi.fn(),
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
    sshMocks.sshDelete.mockReset().mockResolvedValue(undefined);
    sshMocks.sshDownload.mockReset().mockResolvedValue('C:/Downloads/src');
    sshMocks.sshUpload.mockReset().mockResolvedValue(undefined);
    useRemotePathStore.setState({ path: {} });
  });

  afterEach(() => {
    useRemotePathStore.setState(pathSnapshot, true);
    useTerminalStore.setState(terminalSnapshot, true);
    useSessionStore.setState(workspaceSnapshot, true);
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
