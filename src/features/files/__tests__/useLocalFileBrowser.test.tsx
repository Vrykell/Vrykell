import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { useLocalFileBrowser } from '@features/files/hooks/useLocalFileBrowser';

const fsMocks = vi.hoisted(() => ({
  fsHome: vi.fn(),
  fsList: vi.fn(),
  fsDisks: vi.fn(),
}));

vi.mock('@platform/api/fs', () => fsMocks);

let browserApi: ReturnType<typeof useLocalFileBrowser>;

/** Renders the browser with a real scroll container so view memory can round-trip. */
function BrowserHarness({ initialCwd }: { initialCwd?: string }) {
  browserApi = useLocalFileBrowser({ initialCwd });
  return <div data-testid="browser-scroll" ref={browserApi.scrollRef} />;
}

describe('useLocalFileBrowser', () => {
  beforeEach(() => {
    fsMocks.fsHome.mockReset().mockResolvedValue('C:/Users/tester');
    fsMocks.fsDisks.mockReset().mockResolvedValue([]);
    fsMocks.fsList.mockReset().mockResolvedValue([]);
  });

  it('initializes from the terminal cwd and loads its entries', async () => {
    const entries = [{ name: 'src', path: 'C:/workspace/src', is_dir: true }];
    fsMocks.fsList.mockResolvedValue(entries);
    const { result } = renderHook(() => useLocalFileBrowser({ initialCwd: 'C:\\workspace' }));

    await waitFor(() => expect(result.current.path).toBe('C:/workspace'));
    await waitFor(() => expect(result.current.entries).toEqual(entries));
    expect(fsMocks.fsList).toHaveBeenCalledWith('C:/workspace');
  });

  it('loads and caches children when a directory is expanded', async () => {
    const folder = { name: 'src', path: 'C:/workspace/src', is_dir: true };
    const children = [{ name: 'main.ts', path: 'C:/workspace/src/main.ts', is_dir: false }];
    fsMocks.fsList.mockImplementation((path?: string) => Promise.resolve(path === folder.path ? children : [folder]));
    const { result } = renderHook(() => useLocalFileBrowser({ initialCwd: 'C:/workspace' }));

    await waitFor(() => expect(result.current.entries).toEqual([folder]));
    act(() => result.current.toggleExpand(folder));
    await waitFor(() => expect(result.current.childCache[folder.path]).toEqual(children));
    expect(result.current.expandedSet.has(folder.path)).toBe(true);

    act(() => result.current.toggleExpand(folder));
    expect(fsMocks.fsList).toHaveBeenCalledTimes(2);
    expect(result.current.expandedSet.has(folder.path)).toBe(false);
  });

  it('uses the home directory once when no initial cwd is available', async () => {
    const { result, rerender } = renderHook((props) => useLocalFileBrowser(props), {
      initialProps: { initialCwd: undefined as string | undefined },
    });
    await waitFor(() => expect(result.current.path).toBe('C:/Users/tester'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    fsMocks.fsList.mockClear();
    rerender({ initialCwd: 'C:/new-terminal-directory' });
    expect(result.current.path).toBe('C:/Users/tester');
    expect(fsMocks.fsList).not.toHaveBeenCalled();
  });

  it('does not override explicit disk navigation when a delayed home lookup completes', async () => {
    let resolveHome!: (home: string) => void;
    fsMocks.fsHome.mockImplementation(() => new Promise<string>(resolve => { resolveHome = resolve; }));
    const { result } = renderHook(() => useLocalFileBrowser({}));
    act(() => result.current.navigate(null));
    await act(async () => resolveHome('C:/Users/tester'));
    expect(result.current.path).toBeNull();
    expect(fsMocks.fsList).not.toHaveBeenCalled();
  });

  it('keeps browsing and expanded children across terminal cwd and focus changes', async () => {
    const folder = { name: 'src', path: 'C:/workspace/src', is_dir: true };
    const children = [{ name: 'main.ts', path: `${folder.path}/main.ts`, is_dir: false }];
    fsMocks.fsList.mockImplementation((path: string) => Promise.resolve(path === folder.path ? children : [folder]));
    const { result, rerender } = renderHook((props) => useLocalFileBrowser(props), {
      initialProps: { initialCwd: 'C:/elsewhere' },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.navigate('C:/workspace'));
    await waitFor(() => expect(result.current.entries).toEqual([folder]));
    act(() => result.current.toggleExpand(folder));
    await waitFor(() => expect(result.current.childCache[folder.path]).toEqual(children));
    fsMocks.fsList.mockClear();

    rerender({ initialCwd: folder.path });
    // The shell may report its cwd after editor startup and output arrive asynchronously.
    rerender({ initialCwd: 'C:/workspace/src/' });
    expect(result.current.path).toBe('C:/workspace');
    expect(result.current.entries).toEqual([folder]);
    expect(result.current.expandedSet.has(folder.path)).toBe(true);
    expect(result.current.childCache[folder.path]).toEqual(children);
    expect(fsMocks.fsList).not.toHaveBeenCalled();

    act(() => result.current.navigate('C:/manual'));
    await waitFor(() => expect(fsMocks.fsList).toHaveBeenCalledWith('C:/manual'));
    rerender({ initialCwd: 'C:/other' });
    expect(result.current.path).toBe('C:/manual');
    rerender({ initialCwd: 'C:/other/subdir' });
    expect(result.current.path).toBe('C:/manual');
  });

  it('reports a failed directory load and recovers on retry', async () => {
    fsMocks.fsList.mockRejectedValueOnce(new Error('denied')).mockResolvedValue([]);
    const { result } = renderHook(() => useLocalFileBrowser({ initialCwd: 'C:/private' }));
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
    const { result } = renderHook(() => useLocalFileBrowser({ initialCwd: 'C:/old' }));
    await waitFor(() => expect(fsMocks.fsList).toHaveBeenCalledWith('C:/old'));
    act(() => result.current.navigate('C:/new'));
    await waitFor(() => expect(result.current.entries[0]?.name).toBe('new.txt'));
    await act(async () => resolveOld([]));
    expect(result.current.entries[0]?.name).toBe('new.txt');
  });

  it('does not cache a failed tree expansion as an empty directory', async () => {
    const folder = { name: 'private', path: 'C:/workspace/private', is_dir: true };
    fsMocks.fsList.mockImplementation((path: string) => path === folder.path
      ? Promise.reject(new Error('denied')) : Promise.resolve([folder]));
    const { result } = renderHook(() => useLocalFileBrowser({ initialCwd: 'C:/workspace' }));
    await waitFor(() => expect(result.current.entries).toEqual([folder]));
    act(() => result.current.toggleExpand(folder));
    await waitFor(() => expect(result.current.childErrors[folder.path]).toBeDefined());
    expect(result.current.childCache[folder.path]).toBeUndefined();
    fsMocks.fsList.mockResolvedValue([]);
    act(() => result.current.retryExpand(folder));
    await waitFor(() => expect(result.current.childCache[folder.path]).toEqual([]));
    expect(result.current.childErrors[folder.path]).toBeUndefined();
  });

  it('starts forward navigation fresh and tracks back availability', async () => {
    const folder = { name: 'src', path: 'C:/workspace/src', is_dir: true };
    fsMocks.fsList.mockResolvedValue([folder]);
    render(<BrowserHarness initialCwd="C:/workspace" />);
    await waitFor(() => expect(browserApi.entries).toEqual([folder]));

    expect(browserApi.canGoBack).toBe(false);
    act(() => browserApi.selectOnly('C:/workspace/notes.txt'));
    await act(async () => browserApi.navigate('C:/elsewhere'));
    expect(browserApi.path).toBe('C:/elsewhere');
    expect(browserApi.selection.size).toBe(0);
    expect(browserApi.canGoBack).toBe(true);
  });

  it('goBack restores the previous view snapshot', async () => {
    const folder = { name: 'src', path: 'C:/workspace/src', is_dir: true };
    const child = { name: 'main.ts', path: 'C:/workspace/src/main.ts', is_dir: false };
    fsMocks.fsList.mockImplementation((path: string) => Promise.resolve(path === folder.path ? [child] : [folder]));
    render(<BrowserHarness initialCwd="C:/workspace" />);
    await waitFor(() => expect(browserApi.entries).toEqual([folder]));

    act(() => browserApi.toggleExpand(folder));
    await waitFor(() => expect(browserApi.childCache[folder.path]).toEqual([child]));
    act(() => browserApi.selectOnly(folder.path));
    const tree = screen.getByTestId('browser-scroll');
    Object.defineProperty(tree, 'scrollTop', { value: 120, writable: true, configurable: true });

    act(() => browserApi.navigate(folder.path));
    await waitFor(() => expect(browserApi.entries).toEqual([child]));
    expect(browserApi.selection.size).toBe(0);
    // Expansion made while away must not leak into the restored snapshot.
    act(() => browserApi.toggleExpand(folder));
    expect(browserApi.expandedSet.has(folder.path)).toBe(false);

    act(() => browserApi.goBack());
    await waitFor(() => expect(browserApi.entries).toEqual([folder]));
    expect(browserApi.path).toBe('C:/workspace');
    expect(browserApi.selection.has(folder.path)).toBe(true);
    expect(browserApi.anchorPath).toBe(folder.path);
    expect(browserApi.expandedSet.has(folder.path)).toBe(true);
    expect(tree.scrollTop).toBe(120);
    expect(browserApi.canGoBack).toBe(false);
  });

  it('supports ctrl toggle and shift-style range selection with an anchor', async () => {
    const folder = { name: 'src', path: 'C:/workspace/src', is_dir: true };
    fsMocks.fsList.mockResolvedValue([folder]);
    render(<BrowserHarness initialCwd="C:/workspace" />);
    await waitFor(() => expect(browserApi.entries).toEqual([folder]));

    act(() => browserApi.selectOnly('/a'));
    expect([...browserApi.selection]).toEqual(['/a']);
    expect(browserApi.anchorPath).toBe('/a');

    act(() => browserApi.toggleSelection('/b'));
    expect([...browserApi.selection].sort()).toEqual(['/a', '/b']);
    expect(browserApi.anchorPath).toBe('/b');

    act(() => browserApi.toggleSelection('/a'));
    expect([...browserApi.selection]).toEqual(['/b']);

    act(() => browserApi.replaceSelection(['/a', '/b', '/c'], '/a'));
    expect([...browserApi.selection]).toEqual(['/a', '/b', '/c']);
    expect(browserApi.anchorPath).toBe('/a');

    act(() => browserApi.selectOnly(null));
    expect(browserApi.selection.size).toBe(0);
    expect(browserApi.anchorPath).toBeNull();
  });

  it('goBack does nothing when no view has been left', async () => {
    const folder = { name: 'src', path: 'C:/workspace/src', is_dir: true };
    fsMocks.fsList.mockResolvedValue([folder]);
    render(<BrowserHarness initialCwd="C:/workspace" />);
    await waitFor(() => expect(browserApi.entries).toEqual([folder]));

    act(() => browserApi.goBack());
    expect(browserApi.path).toBe('C:/workspace');
    expect(browserApi.entries).toEqual([folder]);
  });

  it('keeps the current scroll offset when navigating to the same path', async () => {
    const folder = { name: 'src', path: 'C:/workspace/src', is_dir: true };
    fsMocks.fsList.mockResolvedValue([folder]);
    render(<BrowserHarness initialCwd="C:/workspace" />);
    await waitFor(() => expect(browserApi.entries).toEqual([folder]));

    const tree = screen.getByTestId('browser-scroll');
    Object.defineProperty(tree, 'scrollTop', { value: 80, writable: true, configurable: true });
    act(() => browserApi.navigate('C:/workspace'));
    expect(browserApi.path).toBe('C:/workspace');
    expect(tree.scrollTop).toBe(80);
    expect(browserApi.canGoBack).toBe(false);
  });

  it('shows the directory loading hint only when the load outlasts the delay', async () => {
    vi.useFakeTimers();
    try {
      let resolveList!: (entries: never[]) => void;
      fsMocks.fsList.mockImplementation(() => new Promise<never[]>((resolve) => { resolveList = resolve; }));
      const { result } = renderHook(() => useLocalFileBrowser({ initialCwd: 'C:/slow' }));

      expect(result.current.loading).toBe(true);
      expect(result.current.loadingHint).toBe(false);
      act(() => { vi.advanceTimersByTime(149); });
      expect(result.current.loadingHint).toBe(false);
      act(() => { vi.advanceTimersByTime(1); });
      expect(result.current.loadingHint).toBe(true);

      await act(async () => { resolveList([]); });
      expect(result.current.loading).toBe(false);
      expect(result.current.loadingHint).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never flashes the directory loading hint when the load settles quickly', async () => {
    vi.useFakeTimers();
    try {
      fsMocks.fsList.mockResolvedValue([]);
      const { result } = renderHook(() => useLocalFileBrowser({ initialCwd: 'C:/fast' }));
      await act(async () => {});

      expect(result.current.loading).toBe(false);
      expect(result.current.loadingHint).toBe(false);
      act(() => { vi.advanceTimersByTime(500); });
      expect(result.current.loadingHint).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the child loading hint only when an expansion outlasts the delay', async () => {
    vi.useFakeTimers();
    try {
      const folder = { name: 'empty', path: 'C:/workspace/empty', is_dir: true };
      let resolveChildren!: (entries: never[]) => void;
      fsMocks.fsList.mockImplementation((path?: string) => path === folder.path
        ? new Promise<never[]>((resolve) => { resolveChildren = resolve; })
        : Promise.resolve([folder]));
      const { result } = renderHook(() => useLocalFileBrowser({ initialCwd: 'C:/workspace' }));
      await act(async () => {});
      expect(result.current.entries).toEqual([folder]);

      act(() => result.current.toggleExpand(folder));
      expect(result.current.childLoadingHint.has(folder.path)).toBe(false);
      act(() => { vi.advanceTimersByTime(149); });
      expect(result.current.childLoadingHint.has(folder.path)).toBe(false);
      act(() => { vi.advanceTimersByTime(1); });
      expect(result.current.childLoadingHint.has(folder.path)).toBe(true);

      await act(async () => { resolveChildren([]); });
      expect(result.current.childLoadingHint.has(folder.path)).toBe(false);
      expect(result.current.childCache[folder.path]).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never flashes the child loading hint when an expansion settles quickly', async () => {
    vi.useFakeTimers();
    try {
      const folder = { name: 'empty', path: 'C:/workspace/empty', is_dir: true };
      fsMocks.fsList.mockImplementation((path?: string) => Promise.resolve(path === folder.path ? [] : [folder]));
      const { result } = renderHook(() => useLocalFileBrowser({ initialCwd: 'C:/workspace' }));
      await act(async () => {});

      act(() => result.current.toggleExpand(folder));
      await act(async () => {});
      expect(result.current.childLoadingHint.has(folder.path)).toBe(false);
      act(() => { vi.advanceTimersByTime(500); });
      expect(result.current.childLoadingHint.has(folder.path)).toBe(false);
      expect(result.current.childCache[folder.path]).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the previous listing visible while the next directory loads', async () => {
    const previous = [{ name: 'old.txt', path: 'C:/old/old.txt', is_dir: false }];
    let resolveNext!: (entries: never[]) => void;
    fsMocks.fsList.mockImplementation((path: string) => path === 'C:/next'
      ? new Promise<never[]>((resolve) => { resolveNext = resolve; })
      : Promise.resolve(previous));
    const { result } = renderHook(() => useLocalFileBrowser({ initialCwd: 'C:/old' }));
    await waitFor(() => expect(result.current.entries).toEqual(previous));

    act(() => result.current.navigate('C:/next'));
    expect(result.current.entries).toEqual(previous);

    await act(async () => { resolveNext([]); });
    expect(result.current.entries).toEqual([]);
  });
});
