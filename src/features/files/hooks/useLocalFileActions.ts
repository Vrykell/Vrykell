import { useCallback, useMemo, useRef, useState } from 'react';
import { openPath } from '@tauri-apps/plugin-opener';
import {
  fsCopy, fsMove, fsRename, fsRestoreStaged, fsPurgeStaged, fsStageDelete, fileOpenWith,
} from '@platform/api/fs';
import type { FileOpPair, FsEntry } from '@platform/api/fs';
import { openFile } from '@features/files/services/fileOpen';
import { parentOf, pathSegments, segmentsToPath } from '@platform/path';
import { shellQuote } from '@features/ssh/utils/remotePath';
import { useWorkspaceDirsStore } from '@features/files/services/workspaceDirs';
import { useSessionStore } from '@features/workspace';
import { ptyWrite } from '@platform/pty';
import { waitForTerminalStartup } from '@features/terminal/services/terminalStartup';
import { useToastStore } from '@ui/Toast';
import type { ContextMenuItem } from '@ui/ContextMenu';

export type LocalFileConfirmState =
  | { kind: 'rename'; entry: FsEntry; newName: string }
  | { kind: 'delete'; entries: FsEntry[] };

export interface LocalFileClipboard {
  mode: 'copy' | 'cut';
  paths: string[];
}

/** 最近一次文件操作的回退记录（只保留一步）。 */
export interface LocalFileUndo {
  kind: 'rename' | 'move' | 'delete';
  label: string;
  pairs: FileOpPair[];
}

interface UseLocalFileActionsOptions {
  path: string | null;
  load: (path: string | null) => void;
  focusedPaneId: string;
  sessions: Record<string, string>;
  /** 右键菜单作用的目标行：命中行属于多选时是整组，否则只有该行。 */
  targetsFor: (entry: FsEntry) => FsEntry[];
  /** 粘贴 / 回退后同步选中项。 */
  onSelectionChange?: (paths: string[]) => void;
  /** 有内容被复制/移动进某个文件夹后通知（用于刷新该文件夹已展开的子列表）。 */
  onFolderMutated?: (folderPath: string) => void;
}

/** 重命名后的新路径（同目录改名）。 */
function renamedPath(entry: FsEntry, newName: string): string {
  return segmentsToPath([...pathSegments(entry.path).slice(0, -1), newName]);
}

/** Manage file actions, clipboard operations and reversible file operations. */
export function useLocalFileActions({
  path,
  load,
  focusedPaneId,
  sessions,
  targetsFor,
  onSelectionChange,
  onFolderMutated,
}: UseLocalFileActionsOptions) {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; entry: FsEntry } | null>(null);
  const [renameTarget, setRenameTarget] = useState<FsEntry | null>(null);
  const [confirm, setConfirm] = useState<LocalFileConfirmState | null>(null);
  const [clipboard, setClipboard] = useState<LocalFileClipboard | null>(null);
  const [undo, setUndo] = useState<LocalFileUndo | null>(null);
  const undoRef = useRef<LocalFileUndo | null>(null);
  const workspaceDirs = useWorkspaceDirsStore();

  const closeContextMenu = useCallback(() => setCtxMenu(null), []);
  const cancelConfirm = useCallback(() => setConfirm(null), []);
  const isWorkspace = useCallback((entryPath: string) => workspaceDirs.contains(entryPath), [workspaceDirs]);

  /**
   * Remember the latest operation for 回退. A superseded reversible delete is pushed
   * to the system trash, so staged items only live for the undo window.
   */
  const recordUndo = useCallback((next: LocalFileUndo | null) => {
    const previous = undoRef.current;
    if (previous?.kind === 'delete') {
      void fsPurgeStaged(previous.pairs.map((pair) => pair.to)).catch(() => {});
    }
    undoRef.current = next;
    setUndo(next);
  }, []);

  const toast = useCallback((message: string, type: 'info' | 'success' | 'error' = 'info') => {
    useToastStore.getState().addToast(message, type);
  }, []);

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

    const parentDir = parentOf(entry.path) ?? undefined;
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

  // ── 剪贴板：复制 / 剪切 / 粘贴 ──

  const copyEntries = useCallback((entries: FsEntry[]) => {
    setClipboard({ mode: 'copy', paths: entries.map((entry) => entry.path) });
    toast(entries.length > 1 ? `已复制 ${entries.length} 项` : '已复制');
  }, [toast]);

  const cutEntries = useCallback((entries: FsEntry[]) => {
    setClipboard({ mode: 'cut', paths: entries.map((entry) => entry.path) });
    toast(entries.length > 1 ? `已剪切 ${entries.length} 项` : '已剪切');
  }, [toast]);

  /**
   * 把条目复制/移动到目标目录：成功项记录回退（移动）、刷新视图与目标文件夹缓存。
   * 粘贴与拖拽共用这一条路径。
   */
  const transferInto = useCallback(async (paths: string[], destDir: string, mode: 'copy' | 'move') => {
    try {
      const outcome = mode === 'copy'
        ? await fsCopy(paths, destDir)
        : await fsMove(paths, destDir);
      if (outcome.completed.length > 0) {
        if (mode === 'move') recordUndo({ kind: 'move', label: '移动', pairs: outcome.completed });
        toast(
          mode === 'copy'
            ? `已复制 ${outcome.completed.length} 项`
            : `已移动 ${outcome.completed.length} 项`,
          'success',
        );
        onSelectionChange?.(outcome.completed.map((pair) => pair.to));
        onFolderMutated?.(destDir);
      }
      if (outcome.errors.length > 0) toast(outcome.errors[0]!, 'error');
      load(path);
    } catch (error) {
      toast(String((error as Error)?.message ?? error), 'error');
    }
  }, [load, onFolderMutated, onSelectionChange, path, recordUndo, toast]);

  /**
   * 粘贴到指定目录；剪切是移动（可回退），复制不改变回退记录。
   * 目标目录由调用方决定：右键文件夹 → 该文件夹，右键文件 / Ctrl+V / 空白处 → 当前目录。
   */
  const pasteInto = useCallback(async (destDir: string | null) => {
    if (!clipboard || destDir === null) return;
    const mode = clipboard.mode === 'cut' ? 'move' : 'copy';
    if (mode === 'move') setClipboard(null);
    await transferInto(clipboard.paths, destDir, mode);
  }, [clipboard, transferInto]);

  /** Ctrl+V / 空白处右键：粘贴到当前目录。 */
  const pasteClipboard = useCallback(() => pasteInto(path), [pasteInto, path]);

  // ── 删除与回退 ──

  const doDelete = useCallback(async (entries: FsEntry[]) => {
    try {
      const staged = await fsStageDelete(entries.map((entry) => entry.path));
      recordUndo({ kind: 'delete', label: '删除', pairs: staged });
      toast(entries.length > 1 ? `已删除 ${entries.length} 项，可在更多菜单回退` : '已删除，可在更多菜单回退', 'success');
      load(path);
    } catch (error) {
      toast(String((error as Error)?.message ?? error), 'error');
    }
  }, [load, path, recordUndo, toast]);

  /** 回退最近一次文件操作（重命名 / 移动 / 删除）。 */
  const runUndo = useCallback(async () => {
    const current = undoRef.current;
    if (!current) return;
    try {
      if (current.kind === 'delete') {
        const outcome = await fsRestoreStaged(current.pairs);
        if (outcome.errors.length > 0) toast(outcome.errors[0]!, 'error');
        if (outcome.completed.length > 0) {
          toast(outcome.completed.length > 1 ? `已回退删除 ${outcome.completed.length} 项` : '已回退删除', 'success');
          onSelectionChange?.(outcome.completed.map((pair) => pair.from));
        }
      } else if (current.kind === 'rename') {
        for (const pair of current.pairs) {
          await fsRename(pair.to, pathSegments(pair.from).pop()!);
        }
        toast('已回退重命名', 'success');
        onSelectionChange?.(current.pairs.map((pair) => pair.from));
      } else {
        // 按原目录分组移回（同一次操作通常来自同一目录）
        const byParent = new Map<string, string[]>();
        for (const pair of current.pairs) {
          const parent = parentOf(pair.from) ?? '/';
          byParent.set(parent, [...(byParent.get(parent) ?? []), pair.to]);
        }
        let restored = 0;
        for (const [parent, movedPaths] of byParent) {
          const outcome = await fsMove(movedPaths, parent);
          if (outcome.errors.length > 0) toast(outcome.errors[0]!, 'error');
          restored += outcome.completed.length;
        }
        if (restored > 0) toast(restored > 1 ? `已回退移动 ${restored} 项` : '已回退移动', 'success');
        onSelectionChange?.(current.pairs.map((pair) => pair.from));
      }
      recordUndo(null);
      load(path);
    } catch (error) {
      toast(String((error as Error)?.message ?? error), 'error');
    }
  }, [load, onSelectionChange, path, recordUndo, toast]);

  // ── 重命名 ──

  const doRename = useCallback((entry: FsEntry, newName: string) => {
    const target = renamedPath(entry, newName);
    fsRename(entry.path, newName)
      .then(() => {
        recordUndo({ kind: 'rename', label: '重命名', pairs: [{ from: entry.path, to: target }] });
        toast('已重命名', 'success');
        load(path);
      })
      .catch((error) => toast(String((error as Error)?.message ?? error), 'error'));
  }, [load, path, recordUndo, toast]);

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
    if (current.kind === 'delete') void doDelete(current.entries);
    else doRename(current.entry, current.newName);
  }, [confirm, doDelete, doRename]);

  // ── 右键菜单 ──

  const buildMenuItems = useCallback((entry: FsEntry): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];
    const targets = targetsFor(entry);
    const multi = targets.length > 1;
    const single = targets[0]!;
    const inWorkspace = isWorkspace(single.path);

    if (!multi && single.is_dir) {
      if (inWorkspace) {
        items.push({
          label: '从工作区移除',
          onClick: () => {
            const workspace = workspaceDirs.dirs.find((item) => item.path === single.path);
            if (workspace) void workspaceDirs.remove(workspace.id);
          },
        });
      } else {
        items.push({ label: '添加到工作区', onClick: () => void workspaceDirs.add(single.path, single.name) });
      }
      items.push({ label: '在新标签页中打开', onClick: () => useSessionStore.getState().addTab({ cwd: single.path, title: single.name }) });
    } else if (!multi) {
      items.push({ label: '使用终端编辑器打开', onClick: () => void openFileInTerminal(single) });
      items.push({ label: '使用系统默认应用打开', onClick: () => void openPath(single.path).catch(() => {}) });
      items.push({
        label: '打开方式…',
        onClick: () => void fileOpenWith(single.path).catch((error) =>
          useToastStore.getState().addToast(String((error as Error)?.message ?? error), 'error')),
      });
    }

    items.push({ label: multi ? `复制 ${targets.length} 项` : '复制', onClick: () => copyEntries(targets) });
    items.push({ label: multi ? `剪切 ${targets.length} 项` : '剪切', onClick: () => cutEntries(targets) });
    if (clipboard && path !== null) {
      // 右键文件夹：粘贴进该文件夹；右键文件或空白处：粘贴到当前目录（文件同级）
      const folderTarget = !multi && single.is_dir ? single : null;
      items.push({
        label: folderTarget
          ? `粘贴到「${folderTarget.name}」`
          : clipboard.mode === 'cut' ? '粘贴（移动）' : '粘贴',
        onClick: () => void pasteInto(folderTarget ? folderTarget.path : path),
      });
    }
    if (!multi) items.push({ label: '复制路径', onClick: () => void navigator.clipboard.writeText(single.path) });
    if (!multi) items.push({ label: '重命名', onClick: () => setRenameTarget(single) });
    items.push({
      label: multi ? `删除 ${targets.length} 项` : '删除',
      danger: true,
      onClick: () => setConfirm({ kind: 'delete', entries: targets }),
    });
    return items;
  }, [clipboard, copyEntries, cutEntries, isWorkspace, openFileInTerminal, pasteInto, path, targetsFor, workspaceDirs]);

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

  const cutPaths = useMemo(
    () => (clipboard?.mode === 'cut' ? new Set(clipboard.paths) : new Set<string>()),
    [clipboard],
  );

  return {
    ctxMenu,
    renameTarget,
    confirm,
    clipboard,
    cutPaths,
    undo,
    closeContextMenu,
    cancelConfirm,
    isWorkspace,
    openFileInTerminal,
    handleContextMenu,
    buildMenuItems,
    requestRename,
    cancelRename,
    confirmAction,
    runUndo,
    syncToTerminal,
    copySelection: copyEntries,
    cutSelection: cutEntries,
    pasteClipboard,
    pasteInto,
    transferInto,
  };
}
