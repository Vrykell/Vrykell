import { useCallback, useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { sshFsList, sshDownload, sshRename, sshDelete, sshUpload } from '@features/ssh/services/api';
import type { SshConnection, SshFsEntry } from '@features/ssh/services/api';
import { loadConfig, remoteOpenCommand } from '@features/files/services/fileOpen';
import { useTerminalStore } from '@features/terminal';
import { useSessionStore } from '@features/workspace';
import { ptyWrite } from '@platform/pty';
import { useToastStore } from '@ui/Toast';
import type { ContextMenuItem } from '@ui/ContextMenu';
import {
  useRemotePathStore,
  normalizeRemotePath,
  parentOfRemote,
  sshPaneIdFor,
  shellQuote,
} from '@features/ssh/utils/remotePath';

export type RemoteFileConfirmState =
  | { kind: 'rename'; entry: SshFsEntry; newName: string }
  | { kind: 'delete'; entry: SshFsEntry };

/** 管理 SSH 文件面板的数据加载和远程文件操作。 */
export function useRemoteFileBrowser(conn: SshConnection) {
  const path = useRemotePathStore((state) => state.path[conn.id] ?? null);
  const setPath = useCallback((nextPath: string | null) => {
    useRemotePathStore.getState().set(conn.id, nextPath);
  }, [conn.id]);
  const [entries, setEntries] = useState<SshFsEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; entry: SshFsEntry } | null>(null);
  const [renameTarget, setRenameTarget] = useState<SshFsEntry | null>(null);
  const [confirm, setConfirm] = useState<RemoteFileConfirmState | null>(null);
  const [showDownloads, setShowDownloads] = useState(false);
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null);

  const toast = useCallback((message: string, type: 'info' | 'success' | 'error') => {
    useToastStore.getState().addToast(message, type);
  }, []);

  const load = useCallback((currentPath: string | null) => {
    setLoading(true);
    setError(null);
    sshFsList(conn.id, currentPath ?? undefined)
      .then((response) => {
        setEntries(response.entries);
        if (currentPath === null && response.base) setPath(normalizeRemotePath(response.base));
      })
      .catch((errorValue) => setError(String((errorValue as Error)?.message ?? errorValue)))
      .finally(() => setLoading(false));
  }, [conn.id, setPath]);

  useEffect(() => {
    load(path);
  }, [load, path]);

  const refresh = useCallback(() => load(path), [load, path]);
  const currentDir = path ?? '';

  const remoteEdit = useCallback((entry: SshFsEntry) => {
    const activeId = useSessionStore.getState().activeId;
    const sid = useTerminalStore.getState().sessions[activeId];
    if (!sid) {
      toast('SSH 会话未就绪', 'info');
      return;
    }
    void ptyWrite(sid, remoteOpenCommand(loadConfig(), entry.path)).catch(() => {});
  }, [toast]);

  const doDownload = useCallback(async (entry: SshFsEntry) => {
    toast(entry.is_dir ? '正在下载文件夹…' : '正在下载…', 'info');
    try {
      const localPath = await sshDownload(conn.id, entry.path);
      toast(`已下载到 ${localPath}`, 'success');
    } catch (errorValue) {
      toast(String((errorValue as Error)?.message ?? errorValue), 'error');
    }
  }, [conn.id, toast]);

  const doRename = useCallback(async (entry: SshFsEntry, newName: string) => {
    try {
      await sshRename(conn.id, entry.path, newName);
      toast('已重命名', 'success');
      refresh();
    } catch (errorValue) {
      toast(String((errorValue as Error)?.message ?? errorValue), 'error');
    }
  }, [conn.id, refresh, toast]);

  const doDelete = useCallback(async (entry: SshFsEntry) => {
    try {
      await sshDelete(conn.id, entry.path);
      toast('已删除', 'success');
      refresh();
    } catch (errorValue) {
      toast(String((errorValue as Error)?.message ?? errorValue), 'error');
    }
  }, [conn.id, refresh, toast]);

  const doUpload = useCallback(async () => {
    const selected = await open({ multiple: true, directory: false });
    const files = (Array.isArray(selected) ? selected : selected ? [selected] : []).filter(Boolean);
    if (files.length === 0) return;
    toast(`开始上传 ${files.length} 个文件…`, 'info');
    let succeeded = 0;
    for (const file of files) {
      try {
        await sshUpload(conn.id, currentDir, file);
        succeeded += 1;
      } catch (errorValue) {
        toast(`${file}：${String((errorValue as Error)?.message ?? errorValue)}`, 'error');
      }
    }
    toast(
      succeeded === files.length ? `已上传 ${succeeded} 个文件` : `上传完成：${succeeded}/${files.length} 成功`,
      succeeded === files.length ? 'success' : 'error',
    );
    refresh();
  }, [conn.id, currentDir, refresh, toast]);

  const doUploadDir = useCallback(async () => {
    const selected = await open({ directory: true });
    const directory = Array.isArray(selected) ? selected[0] : selected;
    if (!directory) return;
    toast('正在上传文件夹…', 'info');
    try {
      await sshUpload(conn.id, currentDir, directory);
      toast('已上传文件夹', 'success');
      refresh();
    } catch (errorValue) {
      toast(String((errorValue as Error)?.message ?? errorValue), 'error');
    }
  }, [conn.id, currentDir, refresh, toast]);

  const handleContextMenu = useCallback((event: React.MouseEvent, entry: SshFsEntry) => {
    event.preventDefault();
    setCtxMenu({ x: event.clientX, y: event.clientY, entry });
  }, []);

  const closeContextMenu = useCallback(() => setCtxMenu(null), []);
  const closeMoreMenu = useCallback(() => setMoreMenu(null), []);
  const openMoreMenu = useCallback((event: React.MouseEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMoreMenu({ x: rect.left, y: rect.bottom + 4 });
  }, []);

  const buildMenuItems = useCallback((entry: SshFsEntry): ContextMenuItem[] => [
    { label: '重命名', onClick: () => setRenameTarget(entry) },
    { label: entry.is_dir ? '下载文件夹到本地' : '下载到本地', onClick: () => void doDownload(entry) },
    { label: '删除', onClick: () => setConfirm({ kind: 'delete', entry }), danger: true },
  ], [doDownload]);

  const requestRename = useCallback((entry: SshFsEntry, newName: string) => {
    setRenameTarget(null);
    const trimmed = newName.trim();
    if (!trimmed || trimmed === entry.name) return;
    setConfirm({ kind: 'rename', entry, newName: trimmed });
  }, []);

  const cancelRename = useCallback(() => setRenameTarget(null), []);
  const cancelConfirm = useCallback(() => setConfirm(null), []);
  const confirmAction = useCallback(() => {
    const current = confirm;
    setConfirm(null);
    if (!current) return;
    if (current.kind === 'delete') void doDelete(current.entry);
    else void doRename(current.entry, current.newName);
  }, [confirm, doDelete, doRename]);

  const goUp = useCallback(() => {
    if (!path || path === '/') return;
    const parent = parentOfRemote(path);
    if (parent) setPath(parent);
  }, [path, setPath]);

  const syncToTerminal = useCallback(async () => {
    if (!path) return;
    const paneId = sshPaneIdFor(conn.id);
    const sid = paneId ? useTerminalStore.getState().sessions[paneId] : null;
    if (!sid) {
      toast('SSH 会话未就绪', 'info');
      return;
    }
    try {
      await ptyWrite(sid, `cd ${shellQuote(path)}\r`);
    } catch (errorValue) {
      toast(String((errorValue as Error)?.message ?? errorValue), 'error');
    }
  }, [conn.id, path, toast]);

  return {
    path,
    setPath,
    entries,
    error,
    loading,
    ctxMenu,
    renameTarget,
    confirm,
    showDownloads,
    moreMenu,
    setShowDownloads,
    closeContextMenu,
    closeMoreMenu,
    openMoreMenu,
    remoteEdit,
    handleContextMenu,
    buildMenuItems,
    requestRename,
    cancelRename,
    cancelConfirm,
    confirmAction,
    goUp,
    syncToTerminal,
    doUpload,
    doUploadDir,
  };
}
