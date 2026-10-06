import { useCallback, useState } from 'react';
import { openPath } from '@tauri-apps/plugin-opener';
import { fsDelete, fsRename, fileOpenWith, type FsEntry } from '@features/files/services/fs';
import { openFile } from '@features/files/services/fileOpen';
import { parentOf, normPath } from '@features/files/utils/pathUtils';
import { shellQuote } from '@features/ssh/utils/remotePath';
import { useWorkspaceDirsStore } from '@features/files/services/workspaceDirs';
import { useSessionStore } from '@features/workspace';
import { ptyWrite } from '@platform/pty';
import { waitForTerminalStartup } from '@features/terminal/services/terminalStartup';
import { useToastStore } from '@ui/Toast';
import type { ContextMenuItem } from '@ui/ContextMenu';

export type LocalFileConfirmState =
  | { kind: 'rename'; entry: FsEntry; newName: string }
  | { kind: 'delete'; entry: FsEntry };

interface UseLocalFileActionsOptions {
  path: string | null;
  load: (path: string | null) => void;
  focusedPaneId: string;
  sessions: Record<string, string>;
}

/** Manage file actions and explicit terminal navigation without changing the browser on file open. */
export function useLocalFileActions({
  path,
  load,
  focusedPaneId,
  sessions,
}: UseLocalFileActionsOptions) {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; entry: FsEntry } | null>(null);
  const [renameTarget, setRenameTarget] = useState<FsEntry | null>(null);
  const [confirm, setConfirm] = useState<LocalFileConfirmState | null>(null);
  const workspaceDirs = useWorkspaceDirsStore();

  const closeContextMenu = useCallback(() => setCtxMenu(null), []);
  const cancelConfirm = useCallback(() => setConfirm(null), []);
  const isWorkspace = useCallback((entryPath: string) => workspaceDirs.contains(entryPath), [workspaceDirs]);

  const openFileInTerminal = useCallback(async (entry: FsEntry) => {
    const addToast = useToastStore.getState().addToast;
    let command = '';
    try {
      const result = await openFile(entry.path, (nextCommand) => { command = nextCommand; });
      if (result.via === 'system') {
        if (result.degraded) addToast('未找到可用的终端编辑器，已用系统默认应用打开', 'info');
        return;
      }
      if (result.fellBack) addToast(`未找到配置的编辑器，已降级为 ${result.editor}`, 'info');
    } catch (error) {
      addToast(String((error as Error)?.message ?? error), 'error');
      return;
    }
    if (!command) return;

    const parentDir = parentOf(normPath(entry.path)) ?? undefined;
    const tabId = useSessionStore.getState().addTab({ cwd: parentDir, title: entry.name });
    try {
      const sid = await waitForTerminalStartup(`${tabId}#0`);
      await ptyWrite(sid, command.endsWith('\n') ? command : `${command}\n`);
    } catch (error) {
      addToast(`无法执行文件打开命令：${String((error as Error)?.message ?? error)}`, 'error');
    }
  }, []);

  const handleContextMenu = useCallback((event: React.MouseEvent, entry: FsEntry) => {
    event.preventDefault();
    setCtxMenu({ x: event.clientX, y: event.clientY, entry });
  }, []);

  const buildMenuItems = useCallback((entry: FsEntry): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];
    const inWorkspace = isWorkspace(entry.path);

    if (entry.is_dir) {
      if (inWorkspace) {
        items.push({
          label: '从工作区移除',
          onClick: () => {
            const workspace = workspaceDirs.dirs.find((item) => item.path === entry.path);
            if (workspace) void workspaceDirs.remove(workspace.id);
          },
        });
      } else {
        items.push({ label: '添加到工作区', onClick: () => void workspaceDirs.add(entry.path, entry.name) });
      }
      items.push({ label: '在新标签页中打开', onClick: () => useSessionStore.getState().addTab({ cwd: entry.path, title: entry.name }) });
    } else {
      items.push({ label: '使用终端编辑器打开', onClick: () => void openFileInTerminal(entry) });
      items.push({ label: '使用系统默认应用打开', onClick: () => void openPath(normPath(entry.path)).catch(() => {}) });
      items.push({
        label: '打开方式…',
        onClick: () => void fileOpenWith(normPath(entry.path)).catch((error) =>
          useToastStore.getState().addToast(String((error as Error)?.message ?? error), 'error')),
      });
    }

    items.push({ label: '复制路径', onClick: () => void navigator.clipboard.writeText(normPath(entry.path)) });
    items.push({ label: '重命名', onClick: () => setRenameTarget(entry) });
    items.push({ label: '删除', danger: true, onClick: () => setConfirm({ kind: 'delete', entry }) });
    return items;
  }, [isWorkspace, openFileInTerminal, workspaceDirs]);

  const doRename = useCallback((entry: FsEntry, newName: string) => {
    fsRename(entry.path, newName)
      .then(() => {
        useToastStore.getState().addToast('已重命名', 'success');
        load(path);
      })
      .catch((error) => useToastStore.getState().addToast(String((error as Error)?.message ?? error), 'error'));
  }, [load, path]);

  const doDelete = useCallback((entry: FsEntry) => {
    fsDelete(entry.path)
      .then(() => {
        useToastStore.getState().addToast('已移入回收站', 'success');
        load(path);
      })
      .catch((error) => useToastStore.getState().addToast(String((error as Error)?.message ?? error), 'error'));
  }, [load, path]);

  const requestRename = useCallback((entry: FsEntry, newName: string) => {
    setRenameTarget(null);
    const trimmed = newName.trim();
    if (!trimmed || trimmed === entry.name) return;
    setConfirm({ kind: 'rename', entry, newName: trimmed });
  }, []);

  const cancelRename = useCallback(() => setRenameTarget(null), []);

  const confirmAction = useCallback(() => {
    const current = confirm;
    setConfirm(null);
    if (!current) return;
    if (current.kind === 'delete') doDelete(current.entry);
    else doRename(current.entry, current.newName);
  }, [confirm, doDelete, doRename]);

  const syncToTerminal = useCallback(async () => {
    if (!path) return;
    const sid = sessions[focusedPaneId];
    if (!sid) {
      useToastStore.getState().addToast('终端会话未就绪', 'info');
      return;
    }
    try {
      await ptyWrite(sid, `cd ${shellQuote(path)}\r`);
    } catch (error) {
      useToastStore.getState().addToast(String((error as Error)?.message ?? error), 'error');
    }
  }, [focusedPaneId, path, sessions]);

  return {
    ctxMenu,
    renameTarget,
    confirm,
    closeContextMenu,
    cancelConfirm,
    isWorkspace,
    openFileInTerminal,
    handleContextMenu,
    buildMenuItems,
    requestRename,
    cancelRename,
    confirmAction,
    syncToTerminal,
  };
}
