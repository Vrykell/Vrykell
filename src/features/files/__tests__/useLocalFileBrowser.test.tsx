import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useLocalFileBrowser } from '@features/files/hooks/useLocalFileBrowser';

const fsMocks = vi.hoisted(() => ({
  fsHome: vi.fn(),
  fsList: vi.fn(),
  fsDisks: vi.fn(),
}));

vi.mock('@features/files/services/fs', () => fsMocks);

describe('useLocalFileBrowser', () => {
  beforeEach(() => {
    fsMocks.fsHome.mockReset().mockResolvedValue('C:/Users/tester');
    fsMocks.fsDisks.mockReset().mockResolvedValue([]);
    fsMocks.fsList.mockReset().mockResolvedValue([]);
  });

  it('follows the active cwd and loads its entries', async () => {
    const entries = [{ name: 'src', path: 'C:/workspace/src', is_dir: true }];
    fsMocks.fsList.mockResolvedValue(entries);
    const { result } = renderHook(() => useLocalFileBrowser({ activeCwd: 'C:\\workspace', focusedPaneId: 'pane-1' }));

    await waitFor(() => expect(result.current.path).toBe('C:/workspace'));
    await waitFor(() => expect(result.current.entries).toEqual(entries));
    expect(fsMocks.fsList).toHaveBeenCalledWith('C:/workspace');
  });

  it('loads and caches children when a directory is expanded', async () => {
    const folder = { name: 'src', path: 'C:/workspace/src', is_dir: true };
    const children = [{ name: 'main.ts', path: 'C:/workspace/src/main.ts', is_dir: false }];
    fsMocks.fsList.mockImplementation((path?: string) => Promise.resolve(path === folder.path ? children : [folder]));
    const { result } = renderHook(() => useLocalFileBrowser({ activeCwd: 'C:/workspace' }));

    await waitFor(() => expect(result.current.entries).toEqual([folder]));
    act(() => result.current.toggleExpand(folder));
    await waitFor(() => expect(result.current.childCache[folder.path]).toEqual(children));
    expect(result.current.expandedSet.has(folder.path)).toBe(true);

    act(() => result.current.toggleExpand(folder));
    expect(fsMocks.fsList).toHaveBeenCalledTimes(2);
    expect(result.current.expandedSet.has(folder.path)).toBe(false);
  });

  it('reports a failed directory load and recovers on retry', async () => {
    fsMocks.fsList.mockRejectedValueOnce(new Error('denied')).mockResolvedValue([]);
    const { result } = renderHook(() => useLocalFileBrowser({ activeCwd: 'C:/private' }));
    await waitFor(() => expect(result.current.error).toBe('无法读取目录，请检查访问权限后重试'));
    expect(result.current.loading).toBe(false);
    act(() => result.current.load(result.current.path));
    await waitFor(() => expect(result.current.error).toBeNull());
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('ignores an earlier directory result after navigating elsewhere', async () => {
    let resolveOld: (entries: never[]) => void = () => {};
    fsMocks.fsList.mockImplementation((path: string) => path === 'C:/old'
      ? new Promise<never[]>((resolve) => { resolveOld = resolve; })
      : Promise.resolve([{ name: 'new.txt', path: 'C:/new/new.txt', is_dir: false }]));
    const { result } = renderHook(() => useLocalFileBrowser({ activeCwd: 'C:/old' }));
    await waitFor(() => expect(fsMocks.fsList).toHaveBeenCalledWith('C:/old'));
    act(() => result.current.setPath('C:/new'));
    await waitFor(() => expect(result.current.entries[0]?.name).toBe('new.txt'));
    await act(async () => resolveOld([]));
    expect(result.current.entries[0]?.name).toBe('new.txt');
  });

  it('does not cache a failed tree expansion as an empty directory', async () => {
    const folder = { name: 'private', path: 'C:/workspace/private', is_dir: true };
    fsMocks.fsList.mockImplementation((path: string) => path === folder.path
      ? Promise.reject(new Error('denied')) : Promise.resolve([folder]));
    const { result } = renderHook(() => useLocalFileBrowser({ activeCwd: 'C:/workspace' }));
    await waitFor(() => expect(result.current.entries).toEqual([folder]));
    act(() => result.current.toggleExpand(folder));
    await waitFor(() => expect(result.current.childErrors[folder.path]).toBeDefined());
    expect(result.current.childCache[folder.path]).toBeUndefined();
    fsMocks.fsList.mockResolvedValue([]);
    act(() => result.current.retryExpand(folder));
    await waitFor(() => expect(result.current.childCache[folder.path]).toEqual([]));
    expect(result.current.childErrors[folder.path]).toBeUndefined();
  });
});
