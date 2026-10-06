import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { FsEntry } from '@features/files/services/fs';
import { useLocalFileActions } from '@features/files/hooks/useLocalFileActions';
import { openFile } from '@features/files/services/fileOpen';
import { useSessionStore } from '@features/workspace';
import { useTerminalStore } from '@features/terminal';
import { ptyWrite } from '@platform/pty';
import { leaf } from '@features/workspace/model/windowLayout';
import { useToastStore } from '@ui/Toast';

const fsMocks = vi.hoisted(() => ({
  fsRename: vi.fn(),
  fsDelete: vi.fn(),
  fileOpenWith: vi.fn(),
}));

/** Spies replace the action on the live store object, so each test restores the original. */
const originalAddTab = useSessionStore.getState().addTab;

vi.mock('@features/files/services/fs', () => fsMocks);
vi.mock('@features/files/services/fileOpen', () => ({ openFile: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openPath: vi.fn() }));
vi.mock('@platform/pty', () => ({ ptyWrite: vi.fn() }));

describe('useLocalFileActions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(openFile).mockReset();
    vi.mocked(ptyWrite).mockReset().mockResolvedValue(undefined);
    useSessionStore.setState({ tabs: [], addTab: originalAddTab });
    useTerminalStore.setState({ sessions: {}, startupStates: {} });
    fsMocks.fsRename.mockReset().mockResolvedValue(undefined);
    fsMocks.fsDelete.mockReset().mockResolvedValue(undefined);
    fsMocks.fileOpenWith.mockReset().mockResolvedValue(undefined);
  });

  const entry: FsEntry = { name: 'old.txt', path: 'C:/workspace/old.txt', is_dir: false };

  it('keeps rename confirmation and executes the confirmed filesystem action', async () => {
    const load = vi.fn();
    const { result } = renderHook(() => useLocalFileActions({
      path: 'C:/workspace',
      setPath: vi.fn(),
      load,
      focusedPaneId: 'pane-1',
      sessions: {},
    }));

    act(() => result.current.requestRename(entry, '  new.txt  '));
    expect(result.current.confirm).toEqual({ kind: 'rename', entry, newName: 'new.txt' });

    act(() => result.current.confirmAction());
    await waitFor(() => expect(fsMocks.fsRename).toHaveBeenCalledWith(entry.path, 'new.txt'));
    expect(load).toHaveBeenCalledWith('C:/workspace');
    expect(result.current.confirm).toBeNull();
  });

  it('tracks context-menu coordinates and navigates to the parent directory', () => {
    const setPath = vi.fn();
    const preventDefault = vi.fn();
    const { result } = renderHook(() => useLocalFileActions({
      path: 'C:/workspace/src',
      setPath,
      load: vi.fn(),
      focusedPaneId: 'pane-1',
      sessions: {},
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

    act(() => result.current.goUp());
    expect(setPath).toHaveBeenCalledWith('C:/workspace');
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
    const setPath = vi.fn();
    const load = vi.fn();
    const { result } = renderHook(() => useLocalFileActions({
      path: 'C:/', setPath, load, focusedPaneId: 'pane-1', sessions: {},
    }));

    await act(async () => result.current.openFileInTerminal(entry));
    expect(addTab).toHaveBeenCalledWith({ cwd: 'C:/workspace', title: 'old.txt' });
    expect(ptyWrite).toHaveBeenCalledWith('editor-session', 'vim C:/workspace/old.txt\n');
    expect(setPath).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it('does not create a terminal when the file opens in a system application', async () => {
    vi.mocked(openFile).mockResolvedValue({ via: 'system', degraded: false });
    const addTab = vi.spyOn(useSessionStore.getState(), 'addTab');
    const { result } = renderHook(() => useLocalFileActions({
      path: 'C:/workspace', setPath: vi.fn(), load: vi.fn(), focusedPaneId: 'pane-1', sessions: {},
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
      path: 'C:/workspace', setPath: vi.fn(), load: vi.fn(), focusedPaneId: 'pane-1', sessions: {},
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
