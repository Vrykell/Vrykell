import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { FsEntry } from '@platform/api/types';
import { useLocalFileActions } from '@features/files/hooks/useLocalFileActions';
import { openFile } from '@features/files/services/fileOpen';
import { useSessionStore } from '@features/workspace';
import { useTerminalStore } from '@features/terminal';
import { ptyWrite } from '@platform/pty';
import { leaf } from '@features/workspace/model/windowLayout';
import { useToastStore } from '@ui/Toast';

const fsMocks = vi.hoisted(() => ({
  fsRename: vi.fn(),
  fsCopy: vi.fn(),
  fsMove: vi.fn(),
  fsStageDelete: vi.fn(),
  fsRestoreStaged: vi.fn(),
  fsPurgeStaged: vi.fn(),
  fileOpenWith: vi.fn(),
}));

/** Spies replace the action on the live store object, so each test restores the original. */
const originalAddTab = useSessionStore.getState().addTab;

vi.mock('@platform/api/fs', () => fsMocks);
vi.mock('@features/files/services/fileOpen', () => ({ openFile: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openPath: vi.fn() }));
vi.mock('@platform/pty', () => ({ ptyWrite: vi.fn() }));

/** 默认右键目标：只有命中行（多选由测试自行注入）。 */
const singleTarget = (entry: FsEntry) => [entry];

describe('useLocalFileActions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(openFile).mockReset();
    vi.mocked(ptyWrite).mockReset().mockResolvedValue(undefined);
    useSessionStore.setState({ tabs: [], addTab: originalAddTab });
    useTerminalStore.setState({ sessions: {}, startupStates: {} });
    fsMocks.fsRename.mockReset().mockResolvedValue(undefined);
    fsMocks.fsCopy.mockReset().mockResolvedValue({ completed: [], errors: [] });
    fsMocks.fsMove.mockReset().mockResolvedValue({ completed: [], errors: [] });
    fsMocks.fsStageDelete.mockReset().mockResolvedValue([]);
    fsMocks.fsRestoreStaged.mockReset().mockResolvedValue({ completed: [], errors: [] });
    fsMocks.fsPurgeStaged.mockReset().mockResolvedValue(undefined);
    fsMocks.fileOpenWith.mockReset().mockResolvedValue(undefined);
  });

  const entry: FsEntry = { name: 'old.txt', path: 'C:/workspace/old.txt', is_dir: false };

  it('keeps rename confirmation, executes it and records an undo step', async () => {
    const load = vi.fn();
    const { result } = renderHook(() => useLocalFileActions({
      path: 'C:/workspace',
      load,
      focusedPaneId: 'pane-1',
      sessions: {},
      targetsFor: singleTarget,
    }));

    act(() => result.current.requestRename(entry, '  new.txt  '));
    expect(result.current.confirm).toEqual({ kind: 'rename', entry, newName: 'new.txt' });

    act(() => result.current.confirmAction());
    await waitFor(() => expect(fsMocks.fsRename).toHaveBeenCalledWith(entry.path, 'new.txt'));
    expect(load).toHaveBeenCalledWith('C:/workspace');
    expect(result.current.confirm).toBeNull();
    await waitFor(() => expect(result.current.undo).toEqual({
      kind: 'rename',
      label: '重命名',
      pairs: [{ from: 'C:/workspace/old.txt', to: 'C:/workspace/new.txt' }],
    }));
  });

  it('tracks context-menu coordinates and closes the menu', () => {
    const preventDefault = vi.fn();
    const { result } = renderHook(() => useLocalFileActions({
      path: 'C:/workspace/src',
      load: vi.fn(),
      focusedPaneId: 'pane-1',
      sessions: {},
      targetsFor: singleTarget,
    }));

    act(() => result.current.handleContextMenu({
      preventDefault,
      clientX: 24,
      clientY: 48,
    } as unknown as React.MouseEvent, entry));
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(result.current.ctxMenu).toMatchObject({ x: 24, y: 48, entry });

    act(() => result.current.closeContextMenu());
    expect(result.current.ctxMenu).toBeNull();
  });

  it('copies and pastes without touching the undo record', async () => {
    const load = vi.fn();
    fsMocks.fsCopy.mockResolvedValue({ completed: [{ from: entry.path, to: 'C:/dest/old.txt' }], errors: [] });
    const { result } = renderHook(() => useLocalFileActions({
      path: 'C:/dest',
      load,
      focusedPaneId: 'pane-1',
      sessions: {},
      targetsFor: singleTarget,
    }));

    act(() => result.current.copySelection([entry]));
    expect(result.current.clipboard).toEqual({ mode: 'copy', paths: [entry.path] });
    expect(result.current.cutPaths.size).toBe(0);

    await act(async () => { await result.current.pasteClipboard(); });
    expect(fsMocks.fsCopy).toHaveBeenCalledWith([entry.path], 'C:/dest');
    expect(load).toHaveBeenCalledWith('C:/dest');
    // 复制不产生回退记录，剪贴板保留以便再次粘贴
    expect(result.current.undo).toBeNull();
    expect(result.current.clipboard).toMatchObject({ mode: 'copy' });
  });

  it('pasting a cut moves the items, clears the clipboard and records a move undo step', async () => {
    fsMocks.fsMove.mockResolvedValue({ completed: [{ from: entry.path, to: 'C:/dest/old.txt' }], errors: [] });
    const { result } = renderHook(() => useLocalFileActions({
      path: 'C:/dest',
      load: vi.fn(),
      focusedPaneId: 'pane-1',
      sessions: {},
      targetsFor: singleTarget,
    }));

    act(() => result.current.cutSelection([entry]));
    expect(result.current.clipboard).toEqual({ mode: 'cut', paths: [entry.path] });
    expect(result.current.cutPaths.has(entry.path)).toBe(true);

    await act(async () => { await result.current.pasteClipboard(); });
    expect(fsMocks.fsMove).toHaveBeenCalledWith([entry.path], 'C:/dest');
    expect(result.current.clipboard).toBeNull();
    expect(result.current.undo).toMatchObject({ kind: 'move', label: '移动' });
  });

  it('delete stages items for undo and purges a superseded staged delete', async () => {
    fsMocks.fsStageDelete.mockResolvedValue([{ from: entry.path, to: 'C:/undo/u-old.txt' }]);
    const load = vi.fn();
    const { result } = renderHook(() => useLocalFileActions({
      path: 'C:/workspace',
      load,
      focusedPaneId: 'pane-1',
      sessions: {},
      targetsFor: singleTarget,
    }));

    // 通过右键菜单触发删除确认
    act(() => {
      const items = result.current.buildMenuItems(entry);
      items.find((item) => item.label === '删除')!.onClick();
    });
    expect(result.current.confirm).toEqual({ kind: 'delete', entries: [entry] });

    await act(async () => { result.current.confirmAction(); });
    await waitFor(() => expect(fsMocks.fsStageDelete).toHaveBeenCalledWith([entry.path]));
    expect(result.current.undo).toMatchObject({ kind: 'delete', label: '删除' });
    expect(load).toHaveBeenCalledWith('C:/workspace');

    // 下一次删除会把上一批暂存项送入系统回收站（回退窗口只保留一步）
    await act(async () => {
      const items = result.current.buildMenuItems(entry);
      items.find((item) => item.label === '删除')!.onClick();
    });
    await act(async () => { result.current.confirmAction(); });
    await waitFor(() => expect(fsMocks.fsPurgeStaged).toHaveBeenCalledWith(['C:/undo/u-old.txt']));

    // 回退删除：把暂存项移回原位并清空回退入口
    fsMocks.fsRestoreStaged.mockResolvedValue({ completed: [{ from: entry.path, to: 'C:/undo/u-old.txt' }], errors: [] });
    await act(async () => { await result.current.runUndo(); });
    expect(fsMocks.fsRestoreStaged).toHaveBeenCalledWith([{ from: entry.path, to: 'C:/undo/u-old.txt' }]);
    expect(result.current.undo).toBeNull();
  });

  it('multi-selection targets show the whole group in the menu and act on it', async () => {
    const second: FsEntry = { name: 'b.txt', path: 'C:/workspace/b.txt', is_dir: false };
    fsMocks.fsCopy.mockResolvedValue({ completed: [], errors: [] });
    const { result } = renderHook(() => useLocalFileActions({
      path: 'C:/workspace',
      load: vi.fn(),
      focusedPaneId: 'pane-1',
      sessions: {},
      targetsFor: () => [entry, second],
    }));

    const items = result.current.buildMenuItems(entry);
    const copy = items.find((item) => item.label === '复制 2 项');
    expect(copy).toBeDefined();
    expect(items.find((item) => item.label === '删除 2 项')).toBeDefined();
    // 多选时不显示只对单行有意义的操作
    expect(items.find((item) => item.label === '重命名')).toBeUndefined();

    act(() => copy!.onClick());
    expect(result.current.clipboard).toEqual({ mode: 'copy', paths: [entry.path, second.path] });
  });

  it('paste target follows the clicked row: folder pastes inside, file pastes into the current directory', async () => {
    const folder: FsEntry = { name: 'docs', path: 'C:/workspace/docs', is_dir: true };
    fsMocks.fsCopy.mockResolvedValue({ completed: [], errors: [] });
    const { result } = renderHook(() => useLocalFileActions({
      path: 'C:/workspace',
      load: vi.fn(),
      focusedPaneId: 'pane-1',
      sessions: {},
      targetsFor: singleTarget,
    }));

    act(() => result.current.copySelection([entry]));
    act(() => {
      result.current.buildMenuItems(folder).find((item) => item.label === '粘贴到「docs」')!.onClick();
    });
    await waitFor(() => expect(fsMocks.fsCopy).toHaveBeenLastCalledWith([entry.path], 'C:/workspace/docs'));

    // 右键文件：粘贴到当前目录（文件同级）
    fsMocks.fsCopy.mockClear();
    act(() => {
      result.current.buildMenuItems(entry).find((item) => item.label === '粘贴')!.onClick();
    });
    await waitFor(() => expect(fsMocks.fsCopy).toHaveBeenLastCalledWith([entry.path], 'C:/workspace'));
  });

  it('shows a paste entry only while the clipboard is filled', () => {
    const { result } = renderHook(() => useLocalFileActions({
      path: 'C:/workspace',
      load: vi.fn(),
      focusedPaneId: 'pane-1',
      sessions: {},
      targetsFor: singleTarget,
    }));

    expect(result.current.buildMenuItems(entry).find((item) => item.label === '粘贴')).toBeUndefined();
    act(() => result.current.copySelection([entry]));
    expect(result.current.buildMenuItems(entry).find((item) => item.label === '粘贴')).toBeDefined();
  });

  it('opens an editor without navigating or reloading the browser', async () => {
    vi.mocked(openFile).mockImplementation(async (_path, write) => {
      write('vim C:/workspace/old.txt');
      return { via: 'terminal', editor: 'vim', fellBack: false };
    });
    const addTab = vi.spyOn(useSessionStore.getState(), 'addTab').mockImplementation(() => {
      useSessionStore.setState({ tabs: [{ id: 'editor-tab', kind: 'session', title: 'old.txt', layout: leaf({ id: 'editor-tab#0', kind: 'local' }) }] });
      useTerminalStore.setState({ sessions: { 'editor-tab#0': 'editor-session' }, startupStates: { 'editor-tab#0': 'ready' } });
      return 'editor-tab';
    });
    const load = vi.fn();
    const { result } = renderHook(() => useLocalFileActions({
      path: 'C:/', load, focusedPaneId: 'pane-1', sessions: {}, targetsFor: singleTarget,
    }));

    await act(async () => result.current.openFileInTerminal(entry));
    expect(addTab).toHaveBeenCalledWith({ cwd: 'C:/workspace', title: 'old.txt' });
    expect(ptyWrite).toHaveBeenCalledWith('editor-session', 'vim C:/workspace/old.txt\n');
    expect(load).not.toHaveBeenCalled();
  });

  it('does not create a terminal when the file opens in a system application', async () => {
    vi.mocked(openFile).mockResolvedValue({ via: 'system', degraded: false });
    const addTab = vi.spyOn(useSessionStore.getState(), 'addTab');
    const { result } = renderHook(() => useLocalFileActions({
      path: 'C:/workspace', load: vi.fn(), focusedPaneId: 'pane-1', sessions: {}, targetsFor: singleTarget,
    }));
    await act(async () => result.current.openFileInTerminal(entry));
    expect(addTab).not.toHaveBeenCalled();
  });

  it('waits for shell readiness after PTY creation and reports a failed command write', async () => {
    vi.mocked(openFile).mockImplementation(async (_path, write) => {
      write('edit C:/workspace/old.txt');
      return { via: 'terminal', editor: 'edit', fellBack: false };
    });
    vi.spyOn(useSessionStore.getState(), 'addTab').mockImplementation(() => {
      useSessionStore.setState({ tabs: [{ id: 'editor-tab', kind: 'session', title: 'old.txt', layout: leaf({ id: 'editor-tab#0', kind: 'local' }) }] });
      useTerminalStore.setState({ sessions: { 'editor-tab#0': 'editor-session' }, startupStates: { 'editor-tab#0': 'starting' } });
      return 'editor-tab';
    });
    const toast = vi.spyOn(useToastStore.getState(), 'addToast');
    const { result } = renderHook(() => useLocalFileActions({
      path: 'C:/workspace', load: vi.fn(), focusedPaneId: 'pane-1', sessions: {}, targetsFor: singleTarget,
    }));
    const opened = result.current.openFileInTerminal(entry);
    await waitFor(() => expect(useTerminalStore.getState().sessions['editor-tab#0']).toBe('editor-session'));
    expect(ptyWrite).not.toHaveBeenCalled();
    vi.mocked(ptyWrite).mockRejectedValueOnce(new Error('write failed'));
    await act(async () => {
      useTerminalStore.getState().setStartupState('editor-tab#0', 'ready');
      await opened;
    });
    expect(ptyWrite).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenCalledWith('无法执行文件打开命令：write failed', 'error');
  });
});
