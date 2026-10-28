import { useFileUndoSettings } from '@config/fileUndo';
import { useToastStore } from '@ui/feedback/Toast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useFileBrowser } from '@features/files/hooks/useFileBrowser';
import type { FileOpsTarget } from '@features/files/model/fileOps';
import type { FsEntry } from '@platform/api/types';

const fsMocks = vi.hoisted(() => ({
  fsList: vi.fn(),
  fsHome: vi.fn(),
  fsDisks: vi.fn(),
  fsRename: vi.fn(),
  fsCreateFile: vi.fn(),
  fsCreateDir: vi.fn(),
  fsCopy: vi.fn(),
  fsMove: vi.fn(),
  fsStageDelete: vi.fn(),
  fsRestoreStaged: vi.fn(),
  fsPurgeStaged: vi.fn(),
  fileOpenWith: vi.fn(),
}));

vi.mock('@platform/api/fs', async () => {
  const actual = await vi.importActual<typeof import('@platform/api/fs')>('@platform/api/fs');
  return { ...actual, ...fsMocks };
});

/** The execution target is constant: implementation selection happens once, matching the panel. */
const LOCAL_TARGET: FileOpsTarget = { kind: 'local' };

const entry = (name: string, path: string, is_dir = false): FsEntry => ({ name, path, is_dir });

describe('useFileBrowser (local target)', () => {
  const openEntry = vi.fn();

  beforeEach(() => {
    useFileUndoSettings.setState({ local: true, remote: true });
    fsMocks.fsHome.mockReset().mockResolvedValue('C:/Users/test');
    fsMocks.fsDisks.mockReset().mockResolvedValue([]);
    fsMocks.fsList.mockReset().mockResolvedValue([entry('src', 'C:/work/src', true), entry('a.txt', 'C:/work/a.txt')]);
    fsMocks.fsRename.mockReset().mockImplementation((path: string, name: string) => Promise.resolve(`${path.slice(0, path.lastIndexOf('/'))}/${name}`));
    fsMocks.fsCreateFile.mockReset().mockResolvedValue('C:/work/Untitled');
    fsMocks.fsCreateDir.mockReset().mockResolvedValue('C:/work/NewFolder');
    fsMocks.fsCopy.mockReset().mockResolvedValue({ completed: [], errors: [] });
    fsMocks.fsMove.mockReset().mockResolvedValue({ completed: [], errors: [] });
    fsMocks.fsStageDelete.mockReset().mockResolvedValue({ completed: [], errors: [] });
    fsMocks.fsRestoreStaged.mockReset().mockResolvedValue({ completed: [], errors: [] });
    fsMocks.fsPurgeStaged.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => { vi.clearAllMocks(); });

  it('retains undo for completed deletions when a later item fails', async () => {
    const completed = [{ from: 'C:/work/a.txt', to: 'C:/Users/test/.vrykell/undo/u-a.txt' }];
    fsMocks.fsStageDelete.mockResolvedValue({ completed, errors: ['Access denied'] });
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    act(() => result.current.confirmDelete([entry('a.txt', 'C:/work/a.txt'), entry('b.txt', 'C:/work/b.txt')]));
    await act(async () => { result.current.confirmAction(); });
    await waitFor(() => expect(result.current.undo?.pairs).toEqual(completed));
    await act(async () => { await result.current.runUndo(); });
    expect(fsMocks.fsRestoreStaged).toHaveBeenCalledWith(completed);
  });

  it('uses the given directory as the initial view and falls back to the home directory', async () => {
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    expect(fsMocks.fsList).toHaveBeenCalledWith('C:/work');
    expect(result.current.path).toBe('C:/work');

    const noCwd = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, openEntry }));
    await waitFor(() => expect(noCwd.result.current.path).toBe('C:/Users/test'));
  });

  it('treats null as the drive view when initialResolved is true and does not resolve the home directory', async () => {
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: null, initialResolved: true, openEntry }));
    await waitFor(() => expect(fsMocks.fsDisks).toHaveBeenCalled());
    expect(fsMocks.fsHome).not.toHaveBeenCalled();
    expect(result.current.path).toBeNull();
  });

  it('does not re-read the directory when the caller passes a new callback on every render, such as a panel resize', async () => {
    const { result, rerender } = renderHook(
      ({ tick }: { tick: number }) => useFileBrowser({
        target: LOCAL_TARGET,
        initialPath: 'C:/work',
        openEntry,
        // Inline callback: a new function on every render, matching how RemoteFiles passes it.
        onPathChange: () => { void tick; },
      }),
      { initialProps: { tick: 0 } },
    );
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    const callsAfterMount = fsMocks.fsList.mock.calls.length;

    rerender({ tick: 1 });
    rerender({ tick: 2 });

    expect(fsMocks.fsList.mock.calls.length).toBe(callsAfterMount);
  });

  it('pushes a view snapshot on navigation and restores selection and scroll position on back', async () => {
    fsMocks.fsList.mockImplementation((dir?: string | null) => Promise.resolve(
      dir === 'C:/work/src' ? [entry('main.ts', 'C:/work/src/main.ts')] : [entry('src', 'C:/work/src', true), entry('a.txt', 'C:/work/a.txt')],
    ));
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    act(() => result.current.replaceSelection(['C:/work/src', 'C:/work/a.txt']));
    expect(result.current.canGoBack).toBe(false);

    await act(async () => { await result.current.navigate('C:/work/src'); });
    await waitFor(() => expect(result.current.entries[0]?.name).toBe('main.ts'));
    expect(result.current.selection.size).toBe(0);
    expect(result.current.canGoBack).toBe(true);

    act(() => result.current.goBack());
    await waitFor(() => expect(result.current.entries[0]?.name).toBe('src'));
    expect([...result.current.selection].sort()).toEqual(['C:/work/a.txt', 'C:/work/src']);
    expect(result.current.canGoBack).toBe(false);
  });

  it('treats revisiting a directory as trail navigation: back does not fork the old branch and forward returns to the source', async () => {
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    await act(async () => { await result.current.navigate('C:/work/src'); });
    await waitFor(() => expect(result.current.path).toBe('C:/work/src'));

    // Jump back to an already visited root: the cursor returns to the existing entry without a duplicate trail record.
    await act(async () => { await result.current.navigate('C:/work'); });
    await waitFor(() => expect(result.current.path).toBe('C:/work'));
    expect(result.current.canGoBack).toBe(false);
    expect(result.current.canGoForward).toBe(true);

    // Forward returns to the jump source; going back again only moves along the trail.
    act(() => result.current.goForward());
    await waitFor(() => expect(result.current.path).toBe('C:/work/src'));
    expect(result.current.canGoForward).toBe(false);
    act(() => result.current.goBack());
    await waitFor(() => expect(result.current.path).toBe('C:/work'));
  });

  it('restores the previous selection when re-entering a visited directory', async () => {
    fsMocks.fsList.mockImplementation((dir?: string | null) => Promise.resolve(
      dir === 'C:/work/src' ? [entry('main.ts', 'C:/work/src/main.ts')] : [entry('src', 'C:/work/src', true), entry('a.txt', 'C:/work/a.txt')],
    ));
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    await act(async () => { await result.current.navigate('C:/work/src'); });
    await waitFor(() => expect(result.current.path).toBe('C:/work/src'));
    act(() => result.current.selectOnly('C:/work/src/main.ts'));

    // Save the src view on leave and restore it on re-entry.
    await act(async () => { await result.current.navigate('C:/work'); });
    await waitFor(() => expect(result.current.path).toBe('C:/work'));
    await act(async () => { await result.current.navigate('C:/work/src'); });
    await waitFor(() => expect(result.current.path).toBe('C:/work/src'));
    expect([...result.current.selection]).toEqual(['C:/work/src/main.ts']);
  });

  it('drops forward history when entering a new directory', async () => {
    fsMocks.fsList.mockImplementation((dir?: string | null) => Promise.resolve(
      dir === 'C:/work/archive' ? [entry('old.txt', 'C:/work/archive/old.txt')] : [entry('src', 'C:/work/src', true), entry('a.txt', 'C:/work/a.txt')],
    ));
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    await act(async () => { await result.current.navigate('C:/work/src'); });
    await act(async () => { await result.current.navigate('C:/work'); });
    expect(result.current.canGoForward).toBe(true);

    await act(async () => { await result.current.navigate('C:/work/archive'); });
    await waitFor(() => expect(result.current.path).toBe('C:/work/archive'));
    expect(result.current.canGoForward).toBe(false);
    expect(result.current.canGoBack).toBe(true);

    act(() => result.current.goBack());
    await waitFor(() => expect(result.current.path).toBe('C:/work'));
  });

  it('drops the oldest directory when the trail exceeds its limit', async () => {
    fsMocks.fsList.mockResolvedValue([]);
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.path).toBe('C:/work'));

    for (let index = 0; index < 55; index += 1) {
      await act(async () => { await result.current.navigate(`C:/work/d${index}`); });
    }
    expect(result.current.canGoBack).toBe(true);

    let steps = 0;
    while (result.current.canGoBack && steps < 80) {
      act(() => result.current.goBack());
      await waitFor(() => expect(result.current.canGoForward).toBe(true));
      steps += 1;
    }
    // The trail keeps 50 entries: the origin (C:/work) has been evicted, so back stops at the sixth directory.
    expect(steps).toBe(49);
    expect(result.current.path).toBe('C:/work/d5');
  });

  it('lazy-loads and caches children when expanding a directory and does not request again on re-expand', async () => {
    fsMocks.fsList.mockImplementation((dir?: string | null) => Promise.resolve(
      dir === 'C:/work/src' ? [entry('main.ts', 'C:/work/src/main.ts')] : [entry('src', 'C:/work/src', true)],
    ));
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    const folder = result.current.entries[0]!;

    act(() => result.current.toggleExpand(folder));
    await waitFor(() => expect(result.current.childCache['C:/work/src']).toHaveLength(1));
    const calls = fsMocks.fsList.mock.calls.length;

    act(() => result.current.toggleExpand(folder));
    act(() => result.current.toggleExpand(folder));
    expect(fsMocks.fsList.mock.calls.length).toBe(calls);
  });

  it('calls copy or move according to paste mode and records the backend target for undo, including collision avoidance', async () => {
    fsMocks.fsMove.mockResolvedValue({
      completed: [{ from: 'C:/work/a.txt', to: 'C:/work/src/a (1).txt' }],
      errors: [],
    });
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    fsMocks.fsCopy.mockResolvedValue({ completed: [{ from: 'C:/work/a.txt', to: 'C:/work/src/a.txt' }], errors: [] });
    act(() => result.current.copySelection([entry('a.txt', 'C:/work/a.txt')]));
    await act(async () => { await result.current.pasteInto('C:/work/src'); });
    expect(fsMocks.fsCopy).toHaveBeenCalledWith(['C:/work/a.txt'], 'C:/work/src');
    // Copy-paste is undoable too: undo moves the copied entries into the staging area.
    expect(result.current.undo).toMatchObject({ kind: 'remove', labelKey: 'files.undo.paste' });

    act(() => result.current.cutSelection([entry('a.txt', 'C:/work/a.txt')]));
    await act(async () => { await result.current.pasteInto('C:/work/src'); });
    expect(fsMocks.fsMove).toHaveBeenCalledWith(['C:/work/a.txt'], 'C:/work/src');
    expect(result.current.undo?.pairs).toEqual([{ from: 'C:/work/a.txt', to: 'C:/work/src/a (1).txt' }]);
  });

  it('treats cut-paste into the same directory as a no-op, matching backend semantics', async () => {
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    act(() => result.current.cutSelection([entry('a.txt', 'C:/work/a.txt')]));
    await act(async () => { await result.current.pasteInto('C:/work'); });
    expect(fsMocks.fsMove).not.toHaveBeenCalled();
  });

  it('stages deletions and restores them from the history stack', async () => {
    fsMocks.fsStageDelete.mockResolvedValue({ completed: [{ from: 'C:/work/a.txt', to: 'C:/Users/test/.vrykell/undo/u-a.txt' }], errors: [] });
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    act(() => result.current.confirmDelete([entry('a.txt', 'C:/work/a.txt')]));
    await act(async () => { result.current.confirmAction(); });
    await waitFor(() => expect(fsMocks.fsStageDelete).toHaveBeenCalledWith(['C:/work/a.txt']));
    expect(result.current.undo).toMatchObject({ kind: 'delete' });

    fsMocks.fsRestoreStaged.mockResolvedValue({
      completed: [{ from: 'C:/work/a.txt', to: 'C:/Users/test/.vrykell/undo/u-a.txt' }],
      errors: [],
    });
    await act(async () => { await result.current.runUndo(); });
    expect(fsMocks.fsRestoreStaged).toHaveBeenCalled();
    expect(result.current.undoCount).toBe(0);
  });

  it('records the final backend path on rename and remains undoable after collision avoidance', async () => {
    fsMocks.fsRename.mockResolvedValue('C:/work/b (1).txt');
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    act(() => result.current.startRename(entry('a.txt', 'C:/work/a.txt')));
    act(() => result.current.requestRename(entry('a.txt', 'C:/work/a.txt'), 'b.txt'));
    await act(async () => { result.current.confirmAction(); });
    await waitFor(() => expect(result.current.undo?.pairs).toEqual([{ from: 'C:/work/a.txt', to: 'C:/work/b (1).txt' }]));
  });

  it('creates inside the hit folder, starts rename immediately and expands that folder', async () => {
    fsMocks.fsList.mockImplementation((dir?: string | null) => Promise.resolve(
      dir === 'C:/work/src' ? [] : [entry('src', 'C:/work/src', true)],
    ));
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    const folder = result.current.entries[0]!;

    await act(async () => { await result.current.createEntry('file', folder); });
    expect(fsMocks.fsCreateFile).toHaveBeenCalledWith('C:/work/src', 'Untitled');
    expect(result.current.renameTarget?.path).toBe('C:/work/Untitled');
    expect(result.current.expandedSet.has('C:/work/src')).toBe(true);
    expect(result.current.selection.has('C:/work/Untitled')).toBe(true);
  });

  it('creates in the current directory from blank space and beside the file from a file row', async () => {
    const file = entry('a.txt', 'C:/work/a.txt');
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work/a', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    await act(async () => { await result.current.createEntry('dir', null); });
    expect(fsMocks.fsCreateDir).toHaveBeenCalledWith('C:/work/a', 'NewFolder');

    await act(async () => { await result.current.createEntry('file', file); });
    expect(fsMocks.fsCreateFile).toHaveBeenLastCalledWith('C:/work', 'Untitled');
  });

  it('refreshes an expanded child directory after rename instead of keeping the old name', async () => {
    const child = entry('a.txt', 'C:/work/src/a.txt');
    fsMocks.fsList.mockImplementation((dir?: string | null) => Promise.resolve(
      dir === 'C:/work/src' ? [child] : [entry('src', 'C:/work/src', true)],
    ));
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    const folder = result.current.entries[0]!;
    act(() => result.current.toggleExpand(folder));
    await waitFor(() => expect(result.current.childCache['C:/work/src']).toHaveLength(1));

    // Re-read the parent after rename so the cache shows the new name instead of a.txt.
    fsMocks.fsRename.mockResolvedValue('C:/work/src/b.txt');
    fsMocks.fsList.mockImplementation((dir?: string | null) => Promise.resolve(
      dir === 'C:/work/src' ? [entry('b.txt', 'C:/work/src/b.txt')] : [entry('src', 'C:/work/src', true)],
    ));
    act(() => result.current.requestRename(child, 'b.txt'));
    await act(async () => { result.current.confirmAction(); });
    await waitFor(() => expect(result.current.childCache['C:/work/src']?.[0]?.name).toBe('b.txt'));
  });

  it('refreshes an expanded child directory after deletion instead of keeping a ghost entry', async () => {
    const child = entry('a.txt', 'C:/work/src/a.txt');
    fsMocks.fsList.mockImplementation((dir?: string | null) => Promise.resolve(
      dir === 'C:/work/src' ? [child] : [entry('src', 'C:/work/src', true)],
    ));
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    const folder = result.current.entries[0]!;
    act(() => result.current.toggleExpand(folder));
    await waitFor(() => expect(result.current.childCache['C:/work/src']).toHaveLength(1));

    fsMocks.fsStageDelete.mockResolvedValue({ completed: [{ from: child.path, to: 'C:/Users/test/.vrykell/undo/u-a.txt' }], errors: [] });
    fsMocks.fsList.mockImplementation((dir?: string | null) => Promise.resolve(
      dir === 'C:/work/src' ? [] : [entry('src', 'C:/work/src', true)],
    ));
    act(() => result.current.confirmDelete([child]));
    await act(async () => { result.current.confirmAction(); });
    await waitFor(() => expect(result.current.childCache['C:/work/src']).toHaveLength(0));
  });

  it('refreshes the source cache after moving an entry out of an expanded child directory', async () => {
    const child = entry('a.txt', 'C:/work/src/a.txt');
    fsMocks.fsList.mockImplementation((dir?: string | null) => Promise.resolve(
      dir === 'C:/work/archive' ? [] : dir === 'C:/work/src' ? [child] : [entry('src', 'C:/work/src', true)],
    ));
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    const folder = result.current.entries[0]!;
    act(() => result.current.toggleExpand(folder));
    await waitFor(() => expect(result.current.childCache['C:/work/src']).toHaveLength(1));

    fsMocks.fsMove.mockResolvedValue({ completed: [{ from: child.path, to: 'C:/work/archive/a.txt' }], errors: [] });
    // After the move, the source is empty and the destination contains the file.
    fsMocks.fsList.mockImplementation((dir?: string | null) => Promise.resolve(
      dir === 'C:/work/archive'
        ? [entry('a.txt', 'C:/work/archive/a.txt')]
        : dir === 'C:/work/src' ? [] : [entry('src', 'C:/work/src', true)],
    ));
    await act(async () => { await result.current.transferInto([child.path], 'C:/work/archive', 'move'); });
    await waitFor(() => expect(result.current.childCache['C:/work/src']).toHaveLength(0));
    expect(result.current.undo?.pairs).toEqual([{ from: child.path, to: 'C:/work/archive/a.txt' }]);
  });

  it('collapse all clears the expanded set but keeps loaded child caches', async () => {
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    await act(async () => { await result.current.toggleExpand(entry('src', 'C:/work/src')); });
    expect(result.current.expandedSet.has('C:/work/src')).toBe(true);
    await waitFor(() => expect(result.current.childCache['C:/work/src']).toBeDefined());

    act(() => result.current.collapseAll());
    expect(result.current.expandedSet.size).toBe(0);
    // Cache retained: re-expanding does not request again.
    expect(result.current.childCache['C:/work/src']).toBeDefined();
  });

  it('manual refresh re-reads the current directory so external changes show up', async () => {
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    fsMocks.fsList.mockImplementation(() => Promise.resolve([
      entry('src', 'C:/work/src', true), entry('a.txt', 'C:/work/a.txt'), entry('new.txt', 'C:/work/new.txt'),
    ]));
    await act(async () => { result.current.refresh(); });

    await waitFor(() => expect(result.current.entries).toHaveLength(3));
    expect(fsMocks.fsList).toHaveBeenLastCalledWith('C:/work');
    // Refresh re-reads the current directory only: no trail entry, no view change.
    expect(result.current.path).toBe('C:/work');
    expect(result.current.canGoBack).toBe(false);
  });

  it('makes creation undoable by moving the new entry into staging', async () => {
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    await act(async () => { await result.current.createEntry('file', null); });
    expect(result.current.undo).toMatchObject({ kind: 'remove', labelKey: 'files.undo.create' });
    expect(result.current.undo?.pairs).toEqual([{ from: 'C:/work/Untitled', to: 'C:/work/Untitled' }]);

    fsMocks.fsStageDelete.mockResolvedValue({ completed: [{ from: 'C:/work/Untitled', to: 'C:/Users/test/.vrykell/undo/u-Untitled' }], errors: [] });
    await act(async () => { await result.current.runUndo(); });
    expect(fsMocks.fsStageDelete).toHaveBeenCalledWith(['C:/work/Untitled']);
    expect(result.current.undoCount).toBe(0);
  });

  it('creates beside a file in an expanded child directory, refreshes its cache and keeps it expanded', async () => {
    const child = entry('a.txt', 'C:/work/src/a.txt');
    fsMocks.fsList.mockImplementation((dir?: string | null) => Promise.resolve(
      dir === 'C:/work/src' ? [child] : [entry('src', 'C:/work/src', true)],
    ));
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    act(() => result.current.toggleExpand(result.current.entries[0]!));
    await waitFor(() => expect(result.current.childCache['C:/work/src']).toHaveLength(1));

    fsMocks.fsCreateFile.mockResolvedValue('C:/work/src/Untitled');
    fsMocks.fsList.mockImplementation((dir?: string | null) => Promise.resolve(
      dir === 'C:/work/src'
        ? [child, entry('Untitled', 'C:/work/src/Untitled')]
        : [entry('src', 'C:/work/src', true)],
    ));
    await act(async () => { await result.current.createEntry('file', child); });

    // The new entry lands beside the file (in the expanded child directory), so that cache must refresh.
    expect(fsMocks.fsCreateFile).toHaveBeenCalledWith('C:/work/src', 'Untitled');
    expect(result.current.expandedSet.has('C:/work/src')).toBe(true);
    await waitFor(() => expect(result.current.childCache['C:/work/src']).toHaveLength(2));
  });

  it('makes copy-paste undoable by moving the copied entries into staging', async () => {
    fsMocks.fsCopy.mockResolvedValue({ completed: [{ from: 'C:/work/a.txt', to: 'C:/work/src/a (1).txt' }], errors: [] });
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    act(() => result.current.copySelection([entry('a.txt', 'C:/work/a.txt')]));
    await act(async () => { await result.current.pasteInto('C:/work/src'); });
    expect(result.current.undo).toMatchObject({ kind: 'remove', labelKey: 'files.undo.paste' });

    fsMocks.fsStageDelete.mockResolvedValue({ completed: [{ from: 'C:/work/src/a (1).txt', to: 'C:/Users/test/.vrykell/undo/u-a' }], errors: [] });
    await act(async () => { await result.current.runUndo(); });
    expect(fsMocks.fsStageDelete).toHaveBeenCalledWith(['C:/work/src/a (1).txt']);
    expect(result.current.undoCount).toBe(0);
  });

  it('consumes an undo step even on failure so a moved or deleted target leaves no stuck record', async () => {
    fsMocks.fsRename.mockResolvedValueOnce('C:/work/b.txt');
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    act(() => result.current.requestRename(entry('a.txt', 'C:/work/a.txt'), 'b.txt'));
    await act(async () => { result.current.confirmAction(); });
    await waitFor(() => expect(result.current.undoCount).toBe(1));
    expect(result.current.undo?.pairs).toEqual([{ from: 'C:/work/a.txt', to: 'C:/work/b.txt' }]);

    // The file was moved elsewhere: undo fails, but the step must still be consumed.
    fsMocks.fsRename.mockRejectedValueOnce(new Error('File does not exist'));
    await act(async () => { await result.current.runUndo(); });
    expect(result.current.undoCount).toBe(0);
    expect(result.current.undo).toBeNull();
  });

  it('does not keep failed entries after a partial undo and keeps the count in sync with remaining steps', async () => {
    const first = { from: 'C:/work/a.txt', to: 'C:/Users/test/.vrykell/undo/u-a.txt' };
    const second = { from: 'C:/work/b.txt', to: 'C:/Users/test/.vrykell/undo/u-b.txt' };
    fsMocks.fsStageDelete.mockResolvedValue({ completed: [first, second], errors: [] });
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    act(() => result.current.confirmDelete([entry('a.txt', 'C:/work/a.txt'), entry('b.txt', 'C:/work/b.txt')]));
    await act(async () => { result.current.confirmAction(); });
    await waitFor(() => expect(result.current.undoCount).toBe(1));

    // Only one entry can be restored: successes become selected and failures leave the stack.
    fsMocks.fsRestoreStaged.mockResolvedValue({ completed: [first], errors: ['Restore failed: C:/work/b.txt already exists'] });
    await act(async () => { await result.current.runUndo(); });
    expect(result.current.undoCount).toBe(0);
    expect([...result.current.selection]).toEqual(['C:/work/a.txt']);
  });
  it('deletes without staging when local undo is disabled', async () => {
    useFileUndoSettings.getState().update({ local: false });
    fsMocks.fsStageDelete.mockResolvedValue({ completed: [{ from: 'C:/work/a.txt', to: '' }], errors: [] });
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    act(() => result.current.confirmDelete([entry('a.txt', 'C:/work/a.txt')]));
    await act(async () => { result.current.confirmAction(); });
    expect(fsMocks.fsStageDelete).toHaveBeenCalledWith(['C:/work/a.txt'], false);
    expect(result.current.undoCount).toBe(0);
    expect(result.current.undo).toBeNull();
    expect(fsMocks.fsPurgeStaged).not.toHaveBeenCalled();
  });

  it('moves dragged-out sources without promising an undo step when local undo is disabled', async () => {
    useFileUndoSettings.getState().update({ local: false });
    fsMocks.fsStageDelete.mockResolvedValue({ completed: [{ from: 'C:/work/a.txt', to: '' }], errors: [] });
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    await act(async () => { await result.current.removeAfterTransfer([entry('a.txt', 'C:/work/a.txt')]); });
    expect(fsMocks.fsStageDelete).toHaveBeenCalledWith(['C:/work/a.txt'], false);
    expect(result.current.undoCount).toBe(0);
    const toasts = useToastStore.getState().toasts;
    expect(toasts[toasts.length - 1]?.message).toBe('已移动到系统，不保留应用撤销记录');
  });

});
