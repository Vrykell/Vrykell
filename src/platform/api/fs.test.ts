/**
 * api/fs — 本地文件系统 invoke 封装：命令透传 + 跨边界路径归一化。
 */
import { describe, it, expect, vi } from 'vitest';
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
import {
  fsList, fsDisks, fsHome, fsRename, fsCreateFile, fsCreateDir, fsCopy, fsMove, fsStageDelete, fsRestoreStaged, fsPurgeStaged, fsStat, fileOpenWith,
} from '@platform/api/fs';

describe('api/fs 封装', () => {
  it('各命令按约定透传', async () => {
    invokeMock.mockResolvedValueOnce([{ name: 'a', path: '/a', is_dir: false }]);
    await fsList('/x');
    expect(invokeMock).toHaveBeenLastCalledWith('fs_list', { path: '/x' });
    invokeMock.mockResolvedValueOnce([]);
    await fsList();
    expect(invokeMock).toHaveBeenLastCalledWith('fs_list', { path: null });
    invokeMock.mockResolvedValueOnce([{ name: '/', path: '/', total_bytes: 1, free_bytes: 1 }]);
    await fsDisks();
    expect(invokeMock).toHaveBeenLastCalledWith('fs_disks');
    invokeMock.mockResolvedValueOnce('/home/u');
    await fsHome();
    expect(invokeMock).toHaveBeenLastCalledWith('fs_home');
    invokeMock.mockResolvedValueOnce('/a/b');
    await fsRename('/a', 'b');
    expect(invokeMock).toHaveBeenLastCalledWith('fs_rename', { oldPath: '/a', newName: 'b' });
    invokeMock.mockResolvedValueOnce('/a/Untitled');
    await fsCreateFile('/a', 'Untitled');
    expect(invokeMock).toHaveBeenLastCalledWith('fs_create_file', { dir: '/a', name: 'Untitled' });
    invokeMock.mockResolvedValueOnce('/a/NewFolder');
    await fsCreateDir('/a', 'NewFolder');
    expect(invokeMock).toHaveBeenLastCalledWith('fs_create_dir', { dir: '/a', name: 'NewFolder' });
    await fileOpenWith('/a.txt');
    expect(invokeMock).toHaveBeenLastCalledWith('file_open_with', { path: '/a.txt' });
  });

  it('出参路径在边界处归一化（原生反斜杠不进业务状态）', async () => {
    invokeMock.mockResolvedValueOnce([
      { name: '.android', path: 'C:\\Users\\37863\\.android', is_dir: true },
      { name: 'notes.txt', path: '/home/e2e/notes.txt', is_dir: false },
    ]);
    await expect(fsList('C:\\Users\\37863')).resolves.toMatchObject([
      { path: 'C:/Users/37863/.android' },
      { path: '/home/e2e/notes.txt' },
    ]);
    expect(invokeMock).toHaveBeenLastCalledWith('fs_list', { path: 'C:/Users/37863' });

    invokeMock.mockResolvedValueOnce([{ name: 'C:', path: 'C:\\', total_bytes: 1, free_bytes: 1 }]);
    await expect(fsDisks()).resolves.toMatchObject([{ path: 'C:/' }]);

    invokeMock.mockResolvedValueOnce('C:\\Users\\37863');
    await expect(fsHome()).resolves.toBe('C:/Users/37863');

    invokeMock.mockResolvedValueOnce('C:\\Users\\37863\\new.txt');
    await expect(fsRename('C:\\Users\\37863\\old.txt', 'new.txt')).resolves.toBe('C:/Users/37863/new.txt');
    expect(invokeMock).toHaveBeenLastCalledWith('fs_rename', { oldPath: 'C:/Users/37863/old.txt', newName: 'new.txt' });
    invokeMock.mockResolvedValueOnce('C:\\Users\\37863\\Untitled');
    await expect(fsCreateFile('C:\\Users\\37863', 'Untitled')).resolves.toBe('C:/Users/37863/Untitled');
    await fileOpenWith('C:\\Users\\37863\\old.txt');
    expect(invokeMock).toHaveBeenLastCalledWith('file_open_with', { path: 'C:/Users/37863/old.txt' });
  });

  it('复制 / 移动：入参归一化，返回的完成项也归一化', async () => {
    invokeMock.mockResolvedValueOnce({ completed: [{ from: 'C:\\a\\x.txt', to: 'C:\\b\\x.txt' }], errors: ['目标已存在'] });
    const copy = await fsCopy(['C:\\a\\x.txt'], 'C:\\b');
    expect(invokeMock).toHaveBeenLastCalledWith('fs_copy', { paths: ['C:/a/x.txt'], destDir: 'C:/b' });
    expect(copy.completed).toEqual([{ from: 'C:/a/x.txt', to: 'C:/b/x.txt' }]);
    expect(copy.errors).toEqual(['目标已存在']);

    invokeMock.mockResolvedValueOnce({ completed: [], errors: [] });
    await fsMove(['/a/x.txt'], '/b');
    expect(invokeMock).toHaveBeenLastCalledWith('fs_move', { paths: ['/a/x.txt'], destDir: '/b' });
  });

  it('可回退删除：暂存映射归一化，回退与清理按约定透传', async () => {
    invokeMock.mockResolvedValueOnce([{ from: 'C:\\Users\\37863\\old.txt', to: 'C:\\Users\\37863\\.vrykell\\undo\\u-old.txt' }]);
    const staged = await fsStageDelete(['C:\\Users\\37863\\old.txt']);
    expect(invokeMock).toHaveBeenLastCalledWith('fs_stage_delete', { paths: ['C:/Users/37863/old.txt'] });
    expect(staged).toEqual([{ from: 'C:/Users/37863/old.txt', to: 'C:/Users/37863/.vrykell/undo/u-old.txt' }]);

    invokeMock.mockResolvedValueOnce({ completed: [{ from: 'C:/a/old.txt', to: 'C:/s/old.txt' }], errors: [] });
    await fsRestoreStaged([{ from: 'C:\\a\\old.txt', to: 'C:\\s\\old.txt' }]);
    expect(invokeMock).toHaveBeenLastCalledWith('fs_restore_staged', {
      items: [{ from: 'C:/a/old.txt', to: 'C:/s/old.txt' }],
    });

    invokeMock.mockResolvedValueOnce(undefined);
    await fsPurgeStaged(['C:\\s\\old.txt']);
    expect(invokeMock).toHaveBeenLastCalledWith('fs_purge_staged', { paths: ['C:/s/old.txt'] });
  });

  it('fsStat 透传并归一化返回路径', async () => {
    invokeMock.mockResolvedValueOnce({
      name: 'notes.txt', path: 'C:\\Users\\37863\\notes.txt', is_dir: false, is_symlink: false,
      size: 42, created_ms: 1, modified_ms: 2,
    });
    await expect(fsStat('C:\\Users\\37863\\notes.txt')).resolves.toMatchObject({
      name: 'notes.txt', path: 'C:/Users/37863/notes.txt', size: 42, modified_ms: 2,
    });
    expect(invokeMock).toHaveBeenLastCalledWith('fs_stat', { path: 'C:/Users/37863/notes.txt' });
  });
});
