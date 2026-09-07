/**
 * fs — 文件系统 invoke 封装透传测试。
 */
import { describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { fileOpenWith, fsDelete, fsDisks, fsHome, fsList, fsRename } from '@/files/fs';

describe('fs 封装', () => {
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
});
