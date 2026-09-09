/**
 * workspaceDirs — 工作区目录 store 测试（mock invoke）。
 */
import { describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { useWorkspaceDirsStore } from '@/features/files/services/workspaceDirs';

describe('workspaceDirs', () => {
  it('load 填充 dirs；contains 判断；remove 过滤', async () => {
    invokeMock.mockResolvedValueOnce([{ id: 1, path: '/proj', name: 'proj' }]);
    await useWorkspaceDirsStore.getState().load();
    const st = useWorkspaceDirsStore.getState();
    expect(st.loaded).toBe(true);
    expect(st.dirs).toEqual([{ id: 1, path: '/proj', name: 'proj' }]);
    expect(st.contains('/proj')).toBe(true);
    expect(st.contains('/nope')).toBe(false);
    invokeMock.mockResolvedValueOnce(undefined);
    await st.remove(1);
    expect(useWorkspaceDirsStore.getState().dirs).toEqual([]);
  });

  it('add 落库后重新加载', async () => {
    invokeMock
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: 2, path: '/x', name: 'x' }]);
    await useWorkspaceDirsStore.getState().add('/x', 'x');
    expect(useWorkspaceDirsStore.getState().dirs).toEqual([{ id: 2, path: '/x', name: 'x' }]);
  });
});
