import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { FsEntry } from '@features/files/services/fs';
import { useLocalFileActions } from '@features/files/hooks/useLocalFileActions';

const fsMocks = vi.hoisted(() => ({
  fsRename: vi.fn(),
  fsDelete: vi.fn(),
  fileOpenWith: vi.fn(),
}));

vi.mock('@features/files/services/fs', () => fsMocks);
vi.mock('@features/files/services/fileOpen', () => ({ openFile: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openPath: vi.fn() }));
vi.mock('@/platform/pty', () => ({ ptyWrite: vi.fn() }));

describe('useLocalFileActions', () => {
  beforeEach(() => {
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
});
