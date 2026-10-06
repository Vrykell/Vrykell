/**
 * api/fs — 本地文件系统 invoke 封装：命令透传 + 跨边界路径归一化。
 */
import { describe, it, expect, vi } from 'vitest';
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
import { fsList, fsDisks, fsHome, fsRename, fsDelete, fileOpenWith } from '@platform/api/fs';

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
    await fsRename('/a', 'b');
    expect(invokeMock).toHaveBeenLastCalledWith('fs_rename', { oldPath: '/a', newName: 'b' });
    await fsDelete('/a');
    expect(invokeMock).toHaveBeenLastCalledWith('fs_delete', { path: '/a' });
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

    await fsRename('C:\\Users\\37863\\old.txt', 'new.txt');
    expect(invokeMock).toHaveBeenLastCalledWith('fs_rename', { oldPath: 'C:/Users/37863/old.txt', newName: 'new.txt' });
    await fsDelete('C:\\Users\\37863\\old.txt');
    expect(invokeMock).toHaveBeenLastCalledWith('fs_delete', { path: 'C:/Users/37863/old.txt' });
    await fileOpenWith('C:\\Users\\37863\\old.txt');
    expect(invokeMock).toHaveBeenLastCalledWith('file_open_with', { path: 'C:/Users/37863/old.txt' });
  });
});
