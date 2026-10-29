import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FsEntry } from '@platform/api/types';
import type { FileListResult, FileOpsTarget } from '../model/fileOps';
import { useFileBrowser } from '../hooks/useFileBrowser';

const backend = vi.hoisted(() => ({ list: vi.fn(), rename: vi.fn(), move: vi.fn(), stageDelete: vi.fn() }));
vi.mock('../model/fileOps', async () => {
  const actual = await vi.importActual<typeof import('../model/fileOps')>('../model/fileOps');
  return { ...actual, fileOpsFor: (target: FileOpsTarget) => ({ ...actual.fileOpsFor(target), ...backend }) };
});

const local: FileOpsTarget = { kind: 'local' };
const remote: FileOpsTarget = { kind: 'ssh', connectionId: 'sync-test' };
const folder = (path: string): FsEntry => ({ name: path.split('/').pop()!, path, is_dir: true });
const file = (path: string): FsEntry => ({ ...folder(path), is_dir: false });
const listing = (entries: FsEntry[]): FileListResult => ({ base: null, entries });

function deferred() {
  let resolve!: (result: FileListResult) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<FileListResult>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
  backend.rename.mockReset().mockResolvedValue('/work/src/new.txt');
  backend.move.mockReset().mockResolvedValue({ completed: [], errors: [] });
  backend.stageDelete.mockReset().mockResolvedValue({ completed: [], errors: [] });
  backend.list.mockReset().mockImplementation((path: string) => Promise.resolve(listing(
    path === '/work' ? [folder('/work/src'), folder('/work/closed')] : [file(`${path}/old.txt`)],
  )));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function mount(target: FileOpsTarget = local) {
  const hook = renderHook(({ enabled }) => useFileBrowser({ target, enabled, initialPath: '/work', openEntry: vi.fn() }),
    { initialProps: { enabled: true } });
  await act(async () => {});
  return hook;
}

describe('file tree synchronization', () => {
  it('refreshes every visible depth without reading collapsed branches or losing the view', async () => {
    backend.list.mockImplementation((path: string) => Promise.resolve(listing(path === '/work'
      ? [folder('/work/src'), folder('/work/closed')]
      : path === '/work/src' ? [folder('/work/src/deep')] : [file(`${path}/old.txt`)])));
    const { result } = await mount();
    await act(async () => { result.current.toggleExpand(folder('/work/src')); });
    await act(async () => { result.current.toggleExpand(folder('/work/src/deep')); });
    act(() => result.current.selectOnly('/work/src'));
    backend.list.mockImplementation((path: string) => Promise.resolve(listing(path === '/work'
      ? [folder('/work/src'), folder('/work/closed')]
      : path === '/work/src' ? [folder('/work/src/deep')] : [file(`${path}/new.txt`)])));
    backend.list.mockClear();
    await act(async () => { result.current.refresh(); });
    expect(result.current.childCache['/work/src/deep']).toEqual([file('/work/src/deep/new.txt')]);
    expect(backend.list.mock.calls.map(([path]) => path)).toEqual(['/work', '/work/src', '/work/src/deep']);
    expect([...result.current.selection]).toEqual(['/work/src']);
    expect(result.current.expandedSet.size).toBe(2);
    expect(result.current.canGoBack).toBe(false);
  });

  for (const lateFailure of [false, true]) {
    it(`ignores an older child request's late ${lateFailure ? 'failure' : 'success'}`, async () => {
      const { result } = await mount();
      const old = deferred();
      backend.list.mockReturnValueOnce(old.promise);
      act(() => result.current.toggleExpand(folder('/work/src')));
      backend.list.mockResolvedValueOnce(listing([file('/work/src/new.txt')]));
      await act(async () => { await result.current.refreshDir(folder('/work/src')); });
      await act(async () => {
        if (lateFailure) old.reject(new Error('Old request failed'));
        else old.resolve(listing([file('/work/src/old.txt')]));
      });
      expect(result.current.childCache['/work/src']).toEqual([file('/work/src/new.txt')]);
      expect(result.current.childErrors['/work/src']).toBeUndefined();
      expect(result.current.childPending.size).toBe(0);
    });
  }

  for (const target of [local, remote]) {
    it(`restores cached back and forward views while ignoring a late history response (${target.kind})`, async () => {
      const { result } = await mount(target);
      const scroller = document.createElement('div');
      result.current.scrollRef.current = scroller;
      act(() => { result.current.selectOnly('/work/src'); scroller.scrollTop = 42; });
      await act(async () => { await result.current.navigate('/work/src'); });
      act(() => { result.current.selectOnly('/work/src/old.txt'); scroller.scrollTop = 84; });
      const back = deferred();
      const forward = deferred();
      backend.list.mockClear();
      backend.list.mockReturnValueOnce(back.promise).mockReturnValueOnce(forward.promise);
      act(() => result.current.goBack());
      expect(backend.list).not.toHaveBeenCalled();
      expect(result.current.path).toBe('/work');
      expect(result.current.entries).toEqual([folder('/work/src'), folder('/work/closed')]);
      expect(result.current.selection.has('/work/src')).toBe(true);
      expect(scroller.scrollTop).toBe(42);
      await act(async () => { window.dispatchEvent(new Event('focus')); });
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      expect(result.current.loadingHint).toBe(false);
      act(() => result.current.goForward());
      expect(result.current.path).toBe('/work/src');
      expect(result.current.entries).toEqual([file('/work/src/old.txt')]);
      expect(result.current.selection.has('/work/src/old.txt')).toBe(true);
      expect(scroller.scrollTop).toBe(84);
      await act(async () => { back.resolve(listing([file('/work/stale.txt')])); });
      expect(result.current.entries).toEqual([file('/work/src/old.txt')]);
      await act(async () => { window.dispatchEvent(new Event('focus')); });
      await act(async () => { forward.resolve(listing([file('/work/src/new.txt')])); });
      expect(result.current.entries).toEqual([file('/work/src/new.txt')]);
    });

    it(`detects external changes without showing a loading page (${target.kind})`, async () => {
      const { result } = await mount(target);
      await act(async () => { result.current.toggleExpand(folder('/work/src')); });
      backend.list.mockImplementation((path: string) => Promise.resolve(listing(path === '/work'
        ? [folder('/work/src'), file('/work/added.txt')] : [file(`${path}/new.txt`)])));
      await act(async () => { await vi.advanceTimersByTimeAsync(target.kind === 'local' ? 2000 : 10000); });
      expect(result.current.entries.some(entry => entry.name === 'added.txt')).toBe(true);
      expect(result.current.childCache['/work/src']).toEqual([file('/work/src/new.txt')]);
      expect(result.current.loading).toBe(false);
      expect(result.current.loadingHint).toBe(false);
    });
  }

  it('enters a previously expanded directory without waiting for another network request', async () => {
    const { result } = await mount(remote);
    await act(async () => { result.current.toggleExpand(folder('/work/src')); });
    backend.list.mockClear();
    act(() => { void result.current.navigate('/work/src'); });
    expect(result.current.path).toBe('/work/src');
    expect(result.current.entries).toEqual([file('/work/src/old.txt')]);
    expect(backend.list).not.toHaveBeenCalled();
  });

  it('uses a newer child listing when revisiting a directory with an older history snapshot', async () => {
    const { result } = await mount(remote);
    await act(async () => { await result.current.navigate('/work/src'); });
    act(() => result.current.goBack());
    backend.list.mockResolvedValueOnce(listing([file('/work/src/new.txt')]));
    await act(async () => { result.current.toggleExpand(folder('/work/src')); });
    backend.list.mockClear();
    act(() => { void result.current.navigate('/work/src'); });
    expect(result.current.entries).toEqual([file('/work/src/new.txt')]);
    expect(backend.list).not.toHaveBeenCalled();
  });

  it('updates a confirmed rename before the follow-up directory read completes', async () => {
    const { result } = await mount(remote);
    await act(async () => { result.current.toggleExpand(folder('/work/src')); });
    const followUp = deferred();
    backend.list.mockReturnValue(followUp.promise);
    act(() => { result.current.requestRename(file('/work/src/old.txt'), 'new.txt'); });
    await act(async () => { result.current.confirmAction(); });
    expect(result.current.childCache['/work/src']).toEqual([file('/work/src/new.txt')]);
    await act(async () => { followUp.resolve(listing([file('/work/src/new.txt')])); });
  });

  it('keeps cached data intact when a rename fails', async () => {
    const { result } = await mount(remote);
    await act(async () => { result.current.toggleExpand(folder('/work/src')); });
    backend.list.mockClear();
    backend.rename.mockRejectedValueOnce(new Error('Permission denied'));
    act(() => result.current.requestRename(file('/work/src/old.txt'), 'new.txt'));
    await act(async () => { result.current.confirmAction(); });
    expect(result.current.childCache['/work/src']).toEqual([file('/work/src/old.txt')]);
    expect(backend.list).not.toHaveBeenCalled();
    act(() => { void result.current.navigate('/work/src'); });
    expect(result.current.entries).toEqual([file('/work/src/old.txt')]);
  });

  it('does not resurrect an old name when a pre-mutation child read completes late', async () => {
    const { result } = await mount(remote);
    await act(async () => { result.current.toggleExpand(folder('/work/src')); });
    const old = deferred();
    const current = deferred();
    backend.list.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    act(() => { void result.current.refreshDir(folder('/work/src')); });
    act(() => result.current.requestRename(file('/work/src/old.txt'), 'new.txt'));
    await act(async () => { result.current.confirmAction(); });
    await act(async () => { old.resolve(listing([file('/work/src/old.txt')])); });
    expect(result.current.childCache['/work/src']).toEqual([file('/work/src/new.txt')]);
    await act(async () => { current.resolve(listing([file('/work/src/new.txt')])); });
  });

  it('patches history snapshots after a confirmed mutation instead of reviving stale rows on back', async () => {
    const { result } = await mount(remote);
    await act(async () => { await result.current.navigate('/work/src'); });
    act(() => result.current.goBack());
    await act(async () => { result.current.toggleExpand(folder('/work/src')); });
    const refresh = deferred();
    backend.list.mockReturnValue(refresh.promise);
    act(() => result.current.requestRename(file('/work/src/old.txt'), 'new.txt'));
    await act(async () => { result.current.confirmAction(); });
    act(() => result.current.goForward());
    expect(result.current.entries).toEqual([file('/work/src/new.txt')]);
    await act(async () => { refresh.resolve(listing([file('/work/src/old.txt')])); });
    expect(result.current.entries).toEqual([file('/work/src/new.txt')]);
  });

  it('changes only completed sources and destinations after a partially successful move', async () => {
    backend.list.mockImplementation((path: string) => Promise.resolve(listing(path === '/work'
      ? [folder('/work/src'), folder('/work/closed')]
      : path === '/work/src' ? [file('/work/src/one.txt'), file('/work/src/two.txt')] : [])));
    const { result } = await mount(remote);
    await act(async () => { result.current.toggleExpand(folder('/work/src')); });
    await act(async () => { result.current.toggleExpand(folder('/work/closed')); });
    backend.move.mockResolvedValueOnce({ completed: [{ from: '/work/src/one.txt', to: '/work/closed/one (1).txt' }], errors: ['Second source failed'] });
    const refresh = deferred();
    backend.list.mockReturnValue(refresh.promise);
    await act(async () => { await result.current.transferInto(['/work/src/one.txt', '/work/src/two.txt'], '/work/closed', 'move'); });
    expect(result.current.childCache['/work/src']).toEqual([file('/work/src/two.txt')]);
    expect(result.current.childCache['/work/closed']).toEqual([file('/work/closed/one (1).txt')]);
  });

  it('revalidates a failed child read instead of navigating through an older history snapshot', async () => {
    const { result } = await mount(remote);
    await act(async () => { await result.current.navigate('/work/src'); });
    act(() => result.current.goBack());
    backend.list.mockRejectedValueOnce(new Error('Directory disappeared'));
    await act(async () => { result.current.toggleExpand(folder('/work/src')); });
    backend.list.mockResolvedValue(listing([file('/work/src/recreated.txt')]));
    await act(async () => { await result.current.navigate('/work/src'); });
    expect(result.current.entries).toEqual([file('/work/src/recreated.txt')]);
  });

  it('invalidates descendant snapshots after an external directory removal and recreation', async () => {
    const { result } = await mount(remote);
    await act(async () => { await result.current.navigate('/work/src'); });
    act(() => result.current.goBack());
    backend.list.mockResolvedValueOnce(listing([folder('/work/closed')]));
    await act(async () => { result.current.refresh(); });
    backend.list.mockResolvedValue(listing([file('/work/src/recreated.txt')]));
    await act(async () => { await result.current.navigate('/work/src'); });
    expect(result.current.entries).toEqual([file('/work/src/recreated.txt')]);
  });

  it('drops deleted subtree caches and prevents late descendants from returning', async () => {
    const { result } = await mount(remote);
    await act(async () => { result.current.toggleExpand(folder('/work/src')); });
    const child = deferred();
    backend.list.mockReturnValueOnce(child.promise);
    act(() => { void result.current.refreshDir(folder('/work/src')); });
    backend.stageDelete.mockResolvedValueOnce({ completed: [{ from: '/work/src', to: '/staging/src' }], errors: [] });
    backend.list.mockResolvedValue(listing([folder('/work/closed')]));
    act(() => result.current.confirmDelete([folder('/work/src')]));
    await act(async () => { result.current.confirmAction(); });
    await act(async () => { child.resolve(listing([file('/work/src/old.txt')])); });
    expect(result.current.childCache['/work/src']).toBeUndefined();
    expect(result.current.expandedSet.has('/work/src')).toBe(false);
  });

  it('keeps an existing listing and selection throughout a slow manual refresh', async () => {
    const { result } = await mount(remote);
    act(() => result.current.selectOnly('/work/src'));
    const pending = deferred();
    backend.list.mockReturnValueOnce(pending.promise);
    act(() => result.current.refresh());
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.entries).toHaveLength(2);
    expect(result.current.selection.has('/work/src')).toBe(true);
    expect(result.current.loadingHint).toBe(false);
    expect(result.current.loading).toBe(false);
    await act(async () => { pending.resolve(listing([folder('/work/src')])); });
    expect(result.current.entries).toHaveLength(1);
  });

  it('pauses hidden panels and windows and resumes with a full visible-tree check', async () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const { result, rerender } = await mount();
    await act(async () => { result.current.toggleExpand(folder('/work/src')); });
    backend.list.mockClear();
    hidden.mockReturnValue(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(backend.list).not.toHaveBeenCalled();
    hidden.mockReturnValue(false);
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(backend.list.mock.calls.map(([path]) => path)).toEqual(['/work', '/work/src']);
    rerender({ enabled: false });
    backend.list.mockClear();
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(backend.list).not.toHaveBeenCalled();
    await act(async () => { rerender({ enabled: true }); });
    expect(backend.list.mock.calls.map(([path]) => path)).toEqual(['/work', '/work/src']);
  });

  it('does not overlap automatic checks or let a late child result survive a panel switch', async () => {
    const { result, rerender } = await mount();
    await act(async () => { result.current.toggleExpand(folder('/work/src')); });
    const pending = deferred();
    backend.list.mockImplementation((path: string) => path === '/work/src' ? pending.promise
      : Promise.resolve(listing([folder('/work/src')])));
    backend.list.mockClear();
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(backend.list).toHaveBeenCalledTimes(2);
    rerender({ enabled: false });
    await act(async () => { pending.resolve(listing([file('/work/src/stale.txt')])); });
    expect(result.current.childCache['/work/src']).toEqual([file('/work/src/old.txt')]);
  });

  it('stops traversing a branch removed from its parent and refreshes again after a failed read', async () => {
    const { result } = await mount();
    await act(async () => { result.current.toggleExpand(folder('/work/src')); });
    backend.list.mockRejectedValueOnce(new Error('Unavailable'));
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(result.current.error).toBe('Unavailable');
    backend.list.mockClear().mockResolvedValue(listing([file('/work/new.txt')]));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(result.current.error).toBeNull();
    expect(result.current.entries).toEqual([file('/work/new.txt')]);
    expect(backend.list.mock.calls.map(([path]) => path)).toEqual(['/work']);
  });
});
