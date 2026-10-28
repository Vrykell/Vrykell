/**
 * workspaceDirs — workspace directory store tests (invoke mocked).
 */
import { describe, it, expect, vi } from 'vitest';
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
import { useWorkspaceDirsStore } from '@features/files/services/workspaceDirs';

describe('workspaceDirs', () => {
  it('load fills dirs; contains reports membership; remove filters the entry out', async () => {
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

  it('add persists the directory and then reloads', async () => {
    invokeMock.mockResolvedValueOnce(undefined).mockResolvedValueOnce([{ id: 2, path: '/x', name: 'x' }]);
    await useWorkspaceDirsStore.getState().add('/x', 'x');
    expect(useWorkspaceDirsStore.getState().dirs).toEqual([{ id: 2, path: '/x', name: 'x' }]);
  });
});
