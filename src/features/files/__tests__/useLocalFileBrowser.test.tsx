import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { useLocalFileBrowser } from '@features/files/hooks/useLocalFileBrowser';

const fsMocks = vi.hoisted(() => ({
  fsHome: vi.fn(),
  fsList: vi.fn(),
  fsDisks: vi.fn(),
}));

vi.mock('@features/files/services/fs', () => fsMocks);

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
    act(() => browserApi.setSelectedPath('C:/workspace/notes.txt'));
    await act(async () => browserApi.navigate('C:/elsewhere'));
    expect(browserApi.path).toBe('C:/elsewhere');
    expect(browserApi.selectedPath).toBeNull();
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
    act(() => browserApi.setSelectedPath(folder.path));
    const tree = screen.getByTestId('browser-scroll');
    Object.defineProperty(tree, 'scrollTop', { value: 120, writable: true, configurable: true });

    act(() => browserApi.navigate(folder.path));
    await waitFor(() => expect(browserApi.entries).toEqual([child]));
    expect(browserApi.selectedPath).toBeNull();
    // Expansion made while away must not leak into the restored snapshot.
    act(() => browserApi.toggleExpand(folder));
    expect(browserApi.expandedSet.has(folder.path)).toBe(false);

    act(() => browserApi.goBack());
    await waitFor(() => expect(browserApi.entries).toEqual([folder]));
    expect(browserApi.path).toBe('C:/workspace');
    expect(browserApi.selectedPath).toBe(folder.path);
    expect(browserApi.expandedSet.has(folder.path)).toBe(true);
    expect(tree.scrollTop).toBe(120);
    expect(browserApi.canGoBack).toBe(false);
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
});
