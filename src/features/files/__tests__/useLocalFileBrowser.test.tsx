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
});
