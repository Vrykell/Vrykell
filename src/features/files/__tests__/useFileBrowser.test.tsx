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

/** 执行目标是常量：实现选择只发生一次（与面板一致）。 */
const LOCAL_TARGET: FileOpsTarget = { kind: 'local' };

const entry = (name: string, path: string, is_dir = false): FsEntry => ({ name, path, is_dir });

describe('useFileBrowser（本地目标）', () => {
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
    fsMocks.fsStageDelete.mockReset().mockResolvedValue([]);
    fsMocks.fsRestoreStaged.mockReset().mockResolvedValue({ completed: [], errors: [] });
    fsMocks.fsPurgeStaged.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => { vi.clearAllMocks(); });

  it('用给定目录作为起始视图，未给定时落到主目录', async () => {
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    expect(fsMocks.fsList).toHaveBeenCalledWith('C:/work');
    expect(result.current.path).toBe('C:/work');

    const noCwd = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, openEntry }));
    await waitFor(() => expect(noCwd.result.current.path).toBe('C:/Users/test'));
  });

  it('initialResolved 为 true 时 null 表示盘符视图，不再解析主目录', async () => {
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: null, initialResolved: true, openEntry }));
    await waitFor(() => expect(fsMocks.fsDisks).toHaveBeenCalled());
    expect(fsMocks.fsHome).not.toHaveBeenCalled();
    expect(result.current.path).toBeNull();
  });

  it('调用方每次渲染换新回调时不重新拉取目录（如调整面板宽度导致的重渲染）', async () => {
    const { result, rerender } = renderHook(
      ({ tick }: { tick: number }) => useFileBrowser({
        target: LOCAL_TARGET,
        initialPath: 'C:/work',
        openEntry,
        // 内联回调：每次渲染都是新函数（与 RemoteFiles 传入的写法一致）
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

  it('导航压入视图快照，回退还原选中与滚动位置', async () => {
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

  it('回到访问过的目录是轨迹跳转：回退不折返旧分支，前进回到跳转来源', async () => {
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    await act(async () => { await result.current.navigate('C:/work/src'); });
    await waitFor(() => expect(result.current.path).toBe('C:/work/src'));

    // 回跳已经访问过的根目录：光标移回已有条目，不产生重复记录
    await act(async () => { await result.current.navigate('C:/work'); });
    await waitFor(() => expect(result.current.path).toBe('C:/work'));
    expect(result.current.canGoBack).toBe(false);
    expect(result.current.canGoForward).toBe(true);

    // 前进 = 回到跳转来源；再回退仍只沿轨迹移动
    act(() => result.current.goForward());
    await waitFor(() => expect(result.current.path).toBe('C:/work/src'));
    expect(result.current.canGoForward).toBe(false);
    act(() => result.current.goBack());
    await waitFor(() => expect(result.current.path).toBe('C:/work'));
  });

  it('再次进入访问过的目录恢复上次离开时的选中', async () => {
    fsMocks.fsList.mockImplementation((dir?: string | null) => Promise.resolve(
      dir === 'C:/work/src' ? [entry('main.ts', 'C:/work/src/main.ts')] : [entry('src', 'C:/work/src', true), entry('a.txt', 'C:/work/a.txt')],
    ));
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    await act(async () => { await result.current.navigate('C:/work/src'); });
    await waitFor(() => expect(result.current.path).toBe('C:/work/src'));
    act(() => result.current.selectOnly('C:/work/src/main.ts'));

    // 离开 src 时保存它的视图，再次进入时恢复
    await act(async () => { await result.current.navigate('C:/work'); });
    await waitFor(() => expect(result.current.path).toBe('C:/work'));
    await act(async () => { await result.current.navigate('C:/work/src'); });
    await waitFor(() => expect(result.current.path).toBe('C:/work/src'));
    expect([...result.current.selection]).toEqual(['C:/work/src/main.ts']);
  });

  it('进入新目录丢弃前进侧历史', async () => {
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

  it('轨迹超过上限时丢弃最旧目录', async () => {
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
    // 轨迹保持 50 条：起点（C:/work）已被挤出，只能退到第 6 个目录
    expect(steps).toBe(49);
    expect(result.current.path).toBe('C:/work/d5');
  });

  it('展开目录时懒加载子项并缓存，重复展开不再请求', async () => {
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

  it('粘贴按模式调用复制/移动，移动用后端返回的真实目标记录回退（重名避让）', async () => {
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
    // 复制粘贴同样可回退（回退粘贴 = 把复制出来的条目移入暂存）
    expect(result.current.undo).toMatchObject({ kind: 'remove', labelKey: 'files.undo.paste' });

    act(() => result.current.cutSelection([entry('a.txt', 'C:/work/a.txt')]));
    await act(async () => { await result.current.pasteInto('C:/work/src'); });
    expect(fsMocks.fsMove).toHaveBeenCalledWith(['C:/work/a.txt'], 'C:/work/src');
    expect(result.current.undo?.pairs).toEqual([{ from: 'C:/work/a.txt', to: 'C:/work/src/a (1).txt' }]);
  });

  it('同级剪切粘贴是空操作（与后端语义一致）', async () => {
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    act(() => result.current.cutSelection([entry('a.txt', 'C:/work/a.txt')]));
    await act(async () => { await result.current.pasteInto('C:/work'); });
    expect(fsMocks.fsMove).not.toHaveBeenCalled();
  });

  it('删除走暂存并可从历史栈回退', async () => {
    fsMocks.fsStageDelete.mockResolvedValue([{ from: 'C:/work/a.txt', to: 'C:/Users/test/.vrykell/undo/u-a.txt' }]);
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

  it('重命名记录后端返回的最终路径（重名避让后仍可回退）', async () => {
    fsMocks.fsRename.mockResolvedValue('C:/work/b (1).txt');
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    act(() => result.current.startRename(entry('a.txt', 'C:/work/a.txt')));
    act(() => result.current.requestRename(entry('a.txt', 'C:/work/a.txt'), 'b.txt'));
    await act(async () => { result.current.confirmAction(); });
    await waitFor(() => expect(result.current.undo?.pairs).toEqual([{ from: 'C:/work/a.txt', to: 'C:/work/b (1).txt' }]));
  });

  it('新建落在命中的文件夹内，立即进入重命名并展开该目录', async () => {
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

  it('空白处新建使用当前目录，文件行新建落到同级目录', async () => {
    const file = entry('a.txt', 'C:/work/a.txt');
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work/a', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    await act(async () => { await result.current.createEntry('dir', null); });
    expect(fsMocks.fsCreateDir).toHaveBeenCalledWith('C:/work/a', 'NewFolder');

    await act(async () => { await result.current.createEntry('file', file); });
    expect(fsMocks.fsCreateFile).toHaveBeenLastCalledWith('C:/work', 'Untitled');
  });

  it('已展开子目录内重命名后刷新该目录缓存（不残留旧名字）', async () => {
    const child = entry('a.txt', 'C:/work/src/a.txt');
    fsMocks.fsList.mockImplementation((dir?: string | null) => Promise.resolve(
      dir === 'C:/work/src' ? [child] : [entry('src', 'C:/work/src', true)],
    ));
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    const folder = result.current.entries[0]!;
    act(() => result.current.toggleExpand(folder));
    await waitFor(() => expect(result.current.childCache['C:/work/src']).toHaveLength(1));

    // 重命名后父目录重新读取：缓存里换成新名字，而不是继续显示 a.txt
    fsMocks.fsRename.mockResolvedValue('C:/work/src/b.txt');
    fsMocks.fsList.mockImplementation((dir?: string | null) => Promise.resolve(
      dir === 'C:/work/src' ? [entry('b.txt', 'C:/work/src/b.txt')] : [entry('src', 'C:/work/src', true)],
    ));
    act(() => result.current.requestRename(child, 'b.txt'));
    await act(async () => { result.current.confirmAction(); });
    await waitFor(() => expect(result.current.childCache['C:/work/src']?.[0]?.name).toBe('b.txt'));
  });

  it('已展开子目录内删除后刷新该目录缓存（不残留幽灵条目）', async () => {
    const child = entry('a.txt', 'C:/work/src/a.txt');
    fsMocks.fsList.mockImplementation((dir?: string | null) => Promise.resolve(
      dir === 'C:/work/src' ? [child] : [entry('src', 'C:/work/src', true)],
    ));
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    const folder = result.current.entries[0]!;
    act(() => result.current.toggleExpand(folder));
    await waitFor(() => expect(result.current.childCache['C:/work/src']).toHaveLength(1));

    fsMocks.fsStageDelete.mockResolvedValue([{ from: child.path, to: 'C:/Users/test/.vrykell/undo/u-a.txt' }]);
    fsMocks.fsList.mockImplementation((dir?: string | null) => Promise.resolve(
      dir === 'C:/work/src' ? [] : [entry('src', 'C:/work/src', true)],
    ));
    act(() => result.current.confirmDelete([child]));
    await act(async () => { result.current.confirmAction(); });
    await waitFor(() => expect(result.current.childCache['C:/work/src']).toHaveLength(0));
  });

  it('已展开子目录内移走条目后刷新源目录缓存', async () => {
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
    // 移动完成后源目录已空、目标目录有了该文件
    fsMocks.fsList.mockImplementation((dir?: string | null) => Promise.resolve(
      dir === 'C:/work/archive'
        ? [entry('a.txt', 'C:/work/archive/a.txt')]
        : dir === 'C:/work/src' ? [] : [entry('src', 'C:/work/src', true)],
    ));
    await act(async () => { await result.current.transferInto([child.path], 'C:/work/archive', 'move'); });
    await waitFor(() => expect(result.current.childCache['C:/work/src']).toHaveLength(0));
    expect(result.current.undo?.pairs).toEqual([{ from: child.path, to: 'C:/work/archive/a.txt' }]);
  });

  it('收起全部：清空展开集合，保留已加载的子列表缓存', async () => {
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    await act(async () => { await result.current.toggleExpand(entry('src', 'C:/work/src')); });
    expect(result.current.expandedSet.has('C:/work/src')).toBe(true);
    await waitFor(() => expect(result.current.childCache['C:/work/src']).toBeDefined());

    act(() => result.current.collapseAll());
    expect(result.current.expandedSet.size).toBe(0);
    // 缓存保留：重新展开不再请求
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

  it('新建可回退：回退新建把刚建出来的条目移入暂存', async () => {
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    await act(async () => { await result.current.createEntry('file', null); });
    expect(result.current.undo).toMatchObject({ kind: 'remove', labelKey: 'files.undo.create' });
    expect(result.current.undo?.pairs).toEqual([{ from: 'C:/work/Untitled', to: 'C:/work/Untitled' }]);

    fsMocks.fsStageDelete.mockResolvedValue([{ from: 'C:/work/Untitled', to: 'C:/Users/test/.vrykell/undo/u-Untitled' }]);
    await act(async () => { await result.current.runUndo(); });
    expect(fsMocks.fsStageDelete).toHaveBeenCalledWith(['C:/work/Untitled']);
    expect(result.current.undoCount).toBe(0);
  });

  it('在已展开子目录内的文件上新建：刷新该子目录缓存并保持展开', async () => {
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

    // 新条目落在文件的同级目录（也就是那个已展开的子目录），必须刷新它的缓存
    expect(fsMocks.fsCreateFile).toHaveBeenCalledWith('C:/work/src', 'Untitled');
    expect(result.current.expandedSet.has('C:/work/src')).toBe(true);
    await waitFor(() => expect(result.current.childCache['C:/work/src']).toHaveLength(2));
  });

  it('复制粘贴可回退：回退粘贴把复制出来的条目移入暂存', async () => {
    fsMocks.fsCopy.mockResolvedValue({ completed: [{ from: 'C:/work/a.txt', to: 'C:/work/src/a (1).txt' }], errors: [] });
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    act(() => result.current.copySelection([entry('a.txt', 'C:/work/a.txt')]));
    await act(async () => { await result.current.pasteInto('C:/work/src'); });
    expect(result.current.undo).toMatchObject({ kind: 'remove', labelKey: 'files.undo.paste' });

    fsMocks.fsStageDelete.mockResolvedValue([{ from: 'C:/work/src/a (1).txt', to: 'C:/Users/test/.vrykell/undo/u-a' }]);
    await act(async () => { await result.current.runUndo(); });
    expect(fsMocks.fsStageDelete).toHaveBeenCalledWith(['C:/work/src/a (1).txt']);
    expect(result.current.undoCount).toBe(0);
  });

  it('回退失败也会消耗该步：目标已在别处被移动/删除时不再留下退不掉的记录', async () => {
    fsMocks.fsRename.mockResolvedValueOnce('C:/work/b.txt');
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    act(() => result.current.requestRename(entry('a.txt', 'C:/work/a.txt'), 'b.txt'));
    await act(async () => { result.current.confirmAction(); });
    await waitFor(() => expect(result.current.undoCount).toBe(1));
    expect(result.current.undo?.pairs).toEqual([{ from: 'C:/work/a.txt', to: 'C:/work/b.txt' }]);

    // 文件已在别处被移走：回退请求失败，但这一步必须被消耗掉
    fsMocks.fsRename.mockRejectedValueOnce(new Error('文件不存在'));
    await act(async () => { await result.current.runUndo(); });
    expect(result.current.undoCount).toBe(0);
    expect(result.current.undo).toBeNull();
  });

  it('回退部分失败时不保留失败项（计数跟着实际剩余步数走）', async () => {
    const first = { from: 'C:/work/a.txt', to: 'C:/Users/test/.vrykell/undo/u-a.txt' };
    const second = { from: 'C:/work/b.txt', to: 'C:/Users/test/.vrykell/undo/u-b.txt' };
    fsMocks.fsStageDelete.mockResolvedValue([first, second]);
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    act(() => result.current.confirmDelete([entry('a.txt', 'C:/work/a.txt'), entry('b.txt', 'C:/work/b.txt')]));
    await act(async () => { result.current.confirmAction(); });
    await waitFor(() => expect(result.current.undoCount).toBe(1));

    // 只有一项能恢复：成功的记入选中，失败的也不留在栈顶
    fsMocks.fsRestoreStaged.mockResolvedValue({ completed: [first], errors: ['恢复失败：C:/work/b.txt 已存在同名项'] });
    await act(async () => { await result.current.runUndo(); });
    expect(result.current.undoCount).toBe(0);
    expect([...result.current.selection]).toEqual(['C:/work/a.txt']);
  });
  it('deletes without staging when local undo is disabled', async () => {
    useFileUndoSettings.getState().update({ local: false });
    fsMocks.fsStageDelete.mockResolvedValue([{ from: 'C:/work/a.txt', to: '' }]);
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
    fsMocks.fsStageDelete.mockResolvedValue([{ from: 'C:/work/a.txt', to: '' }]);
    const { result } = renderHook(() => useFileBrowser({ target: LOCAL_TARGET, initialPath: 'C:/work', openEntry }));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    await act(async () => { await result.current.removeAfterTransfer([entry('a.txt', 'C:/work/a.txt')]); });
    expect(fsMocks.fsStageDelete).toHaveBeenCalledWith(['C:/work/a.txt'], false);
    expect(result.current.undoCount).toBe(0);
    const toasts = useToastStore.getState().toasts;
    expect(toasts[toasts.length - 1]?.message).toBe('已移动到系统，不保留应用撤销记录');
  });

});
