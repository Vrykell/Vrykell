import { useFileUndoSettings } from '@config/fileUndo';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useFileBrowser } from '@features/files/hooks/useFileBrowser';
import type { FileOpsTarget } from '@features/files/model/fileOps';
import type { FsEntry } from '@platform/api/types';

const sshMocks = vi.hoisted(() => ({
  sshFsList: vi.fn(),
  sshRename: vi.fn(),
  sshCreateFile: vi.fn(),
  sshCreateDir: vi.fn(),
  sshMove: vi.fn(),
  sshCopy: vi.fn(),
  sshStageDelete: vi.fn(),
  sshRestoreStaged: vi.fn(),
  sshPurgeStaged: vi.fn(),
  sshUpload: vi.fn(),
  sshDownload: vi.fn(),
}));

vi.mock('@features/ssh/services/api', () => sshMocks);

const entry = (name: string, path: string, is_dir = false): FsEntry => ({ name, path, is_dir });
const SSH_TARGET: FileOpsTarget = { kind: 'ssh', connectionId: 'ssh-1' };

describe('useFileBrowser（SSH 目标）', () => {
  const openEntry = vi.fn();
  const onPathChange = vi.fn();

  beforeEach(() => {
    useFileUndoSettings.setState({ local: true, remote: true });
    sshMocks.sshFsList.mockReset().mockResolvedValue({
      base: '/home/tester',
      entries: [entry('src', '/home/tester/src', true), entry('a.txt', '/home/tester/a.txt')],
    });
    sshMocks.sshRename.mockReset().mockImplementation((_id: string, path: string, name: string) => Promise.resolve(`${path.slice(0, path.lastIndexOf('/'))}/${name}`));
    sshMocks.sshCreateFile.mockReset().mockResolvedValue('/home/tester/Untitled');
    sshMocks.sshCreateDir.mockReset().mockResolvedValue('/home/tester/NewFolder');
    sshMocks.sshMove.mockReset().mockImplementation((_id: string, path: string, destDir: string) => Promise.resolve(`${destDir}/${path.split('/').pop()}`));
    sshMocks.sshCopy.mockReset().mockResolvedValue({ completed: [], errors: [] });
    sshMocks.sshStageDelete.mockReset().mockResolvedValue({ completed: [], errors: [] });
    sshMocks.sshRestoreStaged.mockReset().mockResolvedValue({ completed: [], errors: [] });
    sshMocks.sshPurgeStaged.mockReset().mockResolvedValue(undefined);
    sshMocks.sshUpload.mockReset().mockResolvedValue(undefined);
    sshMocks.sshDownload.mockReset().mockResolvedValue('C:/Downloads/file');
    onPathChange.mockReset();
  });

  afterEach(() => { vi.clearAllMocks(); });

  it('首次加载用远端主目录解析出的 base，并写回路径', async () => {
    const { result } = renderHook(() => useFileBrowser({ target: SSH_TARGET, onPathChange, openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    expect(sshMocks.sshFsList).toHaveBeenCalledWith('ssh-1', undefined);
    expect(onPathChange).toHaveBeenCalledWith('/home/tester');
  });

  it('隐藏时不连接，重新显示后继续加载（主机信任确认后的重试）', async () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => useFileBrowser({ target: SSH_TARGET, enabled, openEntry }),
      { initialProps: { enabled: false } },
    );
    expect(sshMocks.sshFsList).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
  });

  it('preserves remote staged files on mount', async () => {
    const { result } = renderHook(() => useFileBrowser({ target: SSH_TARGET, openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    expect(sshMocks.sshPurgeStaged).not.toHaveBeenCalled();
  });

  it('选中的条目移动到目标目录：回退对记录后端返回的真实路径', async () => {
    sshMocks.sshMove.mockResolvedValue('/home/tester/archive/a (1).txt');
    const { result } = renderHook(() => useFileBrowser({ target: SSH_TARGET, openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    await act(async () => { await result.current.transferInto(['/home/tester/a.txt'], '/home/tester/archive', 'move'); });
    expect(sshMocks.sshMove).toHaveBeenCalledWith('ssh-1', '/home/tester/a.txt', '/home/tester/archive');
    expect(result.current.undo?.pairs).toEqual([{ from: '/home/tester/a.txt', to: '/home/tester/archive/a (1).txt' }]);
    expect([...result.current.selection]).toEqual(['/home/tester/archive/a (1).txt']);
  });

  it('拖动到同级目录是空操作，不请求后端', async () => {
    const { result } = renderHook(() => useFileBrowser({ target: SSH_TARGET, openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    await act(async () => { await result.current.transferInto(['/home/tester/a.txt'], '/home/tester', 'move'); });
    expect(sshMocks.sshMove).not.toHaveBeenCalled();
  });

  it('粘贴复制到文件夹使用远端 copy，剪切使用 move', async () => {
    const { result } = renderHook(() => useFileBrowser({ target: SSH_TARGET, openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    act(() => result.current.copySelection([entry('a.txt', '/home/tester/a.txt')]));
    await act(async () => { await result.current.pasteInto('/home/tester/src'); });
    expect(sshMocks.sshCopy).toHaveBeenCalledWith('ssh-1', ['/home/tester/a.txt'], '/home/tester/src');

    act(() => result.current.cutSelection([entry('nested.txt', '/home/tester/src/nested.txt')]));
    await act(async () => { await result.current.pasteClipboard(); });
    expect(sshMocks.sshMove).toHaveBeenCalledWith('ssh-1', '/home/tester/src/nested.txt', '/home/tester');
  });

  it('删除走远端暂存，回退用 restore', async () => {
    const staged = { from: '/home/tester/a.txt', to: '/home/tester/.vrykell/undo/u-a.txt' };
    sshMocks.sshStageDelete.mockResolvedValue({ completed: [staged], errors: [] });
    const { result } = renderHook(() => useFileBrowser({ target: SSH_TARGET, openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    act(() => result.current.confirmDelete([entry('a.txt', '/home/tester/a.txt')]));
    await act(async () => { result.current.confirmAction(); });
    await waitFor(() => expect(sshMocks.sshStageDelete).toHaveBeenCalledWith('ssh-1', ['/home/tester/a.txt']));

    sshMocks.sshRestoreStaged.mockResolvedValue({ completed: [staged], errors: [] });
    await act(async () => { await result.current.runUndo(); });
    expect(sshMocks.sshRestoreStaged).toHaveBeenCalledWith('ssh-1', [staged]);
    expect(result.current.undoCount).toBe(0);
  });

  it('重命名使用后端返回的最终路径记录回退', async () => {
    sshMocks.sshRename.mockResolvedValue('/home/tester/b (1).txt');
    const { result } = renderHook(() => useFileBrowser({ target: SSH_TARGET, openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    act(() => result.current.requestRename(entry('a.txt', '/home/tester/a.txt'), 'b.txt'));
    await act(async () => { result.current.confirmAction(); });
    await waitFor(() => expect(result.current.undo?.pairs).toEqual([{ from: '/home/tester/a.txt', to: '/home/tester/b (1).txt' }]));
  });

  it('新建使用远端命令，落在右键命中的目录并立即重命名', async () => {
    sshMocks.sshCreateFile.mockResolvedValue('/home/tester/src/Untitled');
    const { result } = renderHook(() => useFileBrowser({ target: SSH_TARGET, openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    const folder = result.current.entries[0]!;

    await act(async () => { await result.current.createEntry('file', folder); });
    expect(sshMocks.sshCreateFile).toHaveBeenCalledWith('ssh-1', '/home/tester/src', 'Untitled');
    expect(result.current.renameTarget?.path).toBe('/home/tester/src/Untitled');
    expect(result.current.expandedSet.has('/home/tester/src')).toBe(true);
  });
  it('disables remote staging and clears undo without purging staged files', async () => {
    const { result } = renderHook(() => useFileBrowser({ target: SSH_TARGET, openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    await act(async () => { await result.current.transferInto(['/home/tester/a.txt'], '/home/tester/archive', 'move'); });
    expect(result.current.undoCount).toBe(1);
    act(() => useFileUndoSettings.getState().update({ remote: false }));
    expect(result.current.undoCount).toBe(0);
    sshMocks.sshStageDelete.mockResolvedValue({ completed: [{ from: '/home/tester/a.txt', to: '' }], errors: [] });
    act(() => result.current.confirmDelete([entry('a.txt', '/home/tester/a.txt')]));
    await act(async () => { result.current.confirmAction(); });
    expect(sshMocks.sshStageDelete).toHaveBeenCalledWith('ssh-1', ['/home/tester/a.txt'], false);
    expect(sshMocks.sshPurgeStaged).not.toHaveBeenCalled();
    expect(result.current.undo).toBeNull();
  });

});
