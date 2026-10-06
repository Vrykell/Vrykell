import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import {
  sshFsList, sshDownload, sshRename, sshUpload, sshMove,
  sshCopy, sshStageDelete, sshRestoreStaged, sshPurgeStaged, sshSweepUndo,
} from '@features/ssh/services/api';
import type { SshConnection, SshFsEntry, SshOpPair } from '@features/ssh/services/api';
import { loadConfig, remoteOpenCommand } from '@features/files/services/fileOpen';
import { useTerminalStore } from '@features/terminal';
import { useSessionStore } from '@features/workspace';
import { ptyWrite } from '@platform/pty';
import { useToastStore } from '@ui/Toast';
import type { ContextMenuItem } from '@ui/ContextMenu';
import { terminalDebug } from '@features/terminal/services/terminalDebug';
import {
  useRemotePathStore,
  normalizeRemotePath,
  parentOfRemote,
  sshPaneIdFor,
  shellQuote,
} from '@features/ssh/utils/remotePath';

export type RemoteFileConfirmState =
  | { kind: 'rename'; entry: SshFsEntry; newName: string }
  | { kind: 'delete'; entries: SshFsEntry[] };

export interface RemoteClipboard {
  mode: 'copy' | 'cut';
  paths: string[];
}

/** 最近一次远程操作的回退记录（历史栈，栈顶是最近一步）。 */
export interface RemoteUndo {
  kind: 'rename' | 'move' | 'delete';
  label: string;
  pairs: SshOpPair[];
}

/** 回退历史最多保留的步数（更早的步进会把暂存删除项永久删除）。 */
const MAX_UNDO_STEPS = 20;

/** 视图快照：回退按钮回到上一个远程文件树视图。 */
interface RemoteViewSnapshot {
  path: string | null;
  expanded: ReadonlySet<string>;
  selection: ReadonlySet<string>;
  anchorPath: string | null;
  scrollTop: number;
}

/** 远程路径拼接（POSIX）。 */
function joinRemote(dir: string, name: string): string {
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;
}

/** 重命名后的新路径（同目录改名）。 */
function renamedRemotePath(entry: SshFsEntry, newName: string): string {
  const parent = parentOfRemote(entry.path) ?? '/';
  return joinRemote(parent, newName);
}

/** 管理 SSH 文件面板：加载、树形展开、选中、剪贴板与可回退的文件操作（与本地面板一致）。 */
export function useRemoteFileBrowser(conn: SshConnection, enabled = true) {
  const sessionId = useTerminalStore(state => state.sessions[sshPaneIdFor(conn.id) ?? '']);
  const loadVersion = useRef(0);
  const path = useRemotePathStore((state) => state.path[conn.id] ?? null);
  const setStoredPath = useCallback((nextPath: string | null) => {
    useRemotePathStore.getState().set(conn.id, nextPath);
  }, [conn.id]);

  const [entries, setEntries] = useState<SshFsEntry[]>([]);
  const [loadedPath, setLoadedPath] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<RemoteViewSnapshot[]>([]);
  const [selection, setSelectionState] = useState<ReadonlySet<string>>(new Set());
  const [anchorPath, setAnchorPath] = useState<string | null>(null);
  const [expandedSet, setExpandedSet] = useState<ReadonlySet<string>>(new Set());
  const [childCache, setChildCache] = useState<Record<string, SshFsEntry[]>>({});
  const [childLoading, setChildLoading] = useState<ReadonlySet<string>>(new Set());
  const [childErrors, setChildErrors] = useState<Record<string, string>>({});
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollTop = useRef<number | null>(null);
  const [clipboard, setClipboard] = useState<RemoteClipboard | null>(null);
  const [undoStack, setUndoStack] = useState<RemoteUndo[]>([]);
  const undoStackRef = useRef<RemoteUndo[]>([]);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; entry: SshFsEntry } | null>(null);
  const [renameTarget, setRenameTarget] = useState<SshFsEntry | null>(null);
  const [confirm, setConfirm] = useState<RemoteFileConfirmState | null>(null);
  const [showDownloads, setShowDownloads] = useState(false);
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null);
  const alive = useRef(true);

  const toast = useCallback((message: string, type: 'info' | 'success' | 'error' = 'info') => {
    useToastStore.getState().addToast(message, type);
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; loadVersion.current += 1; };
  }, []);

  const load = useCallback((currentPath: string | null) => {
    const version = ++loadVersion.current;
    setLoading(true);
    setError(null);
    terminalDebug('ssh-files-load-start', { connectionId: conn.id, hasPath: currentPath !== null });
    sshFsList(conn.id, currentPath ?? undefined)
      .then((response) => {
        if (version !== loadVersion.current) return;
        setEntries(response.entries);
        setLoadedPath(currentPath);
        terminalDebug('ssh-files-load-ready', { connectionId: conn.id, entries: response.entries.length });
        // 首屏（null）由后端解析到主目录：静默修正路径，不进入回退历史
        if (currentPath === null && response.base) setStoredPath(normalizeRemotePath(response.base));
      })
      .catch((errorValue) => {
        if (version !== loadVersion.current) return;
        setEntries([]);
        setError(String((errorValue as Error)?.message ?? errorValue));
        terminalDebug('ssh-files-load-failed', { connectionId: conn.id, errorType: errorValue instanceof Error ? errorValue.name : typeof errorValue });
      })
      .finally(() => { if (version === loadVersion.current) setLoading(false); });
  }, [conn.id, setStoredPath]);

  useEffect(() => {
    if (!enabled) return;
    load(path);
    // Retry after host confirmation and PTY startup; the first SFTP request may have been untrusted.
    return () => { loadVersion.current += 1; };
  }, [load, path, sessionId, enabled]);

  // 挂载时清掉上一次会话残留的远端暂存项（可回退窗口已结束）
  useEffect(() => {
    if (!enabled) return;
    void sshSweepUndo(conn.id).catch(() => {});
  }, [conn.id, enabled]);

  // 加载完成后还原快照里的滚动位置；此前的提交仍是上一个目录
  useLayoutEffect(() => {
    if (loading || loadedPath !== path || pendingScrollTop.current === null) return;
    const target = pendingScrollTop.current;
    pendingScrollTop.current = null;
    if (scrollRef.current) scrollRef.current.scrollTop = target;
  }, [loadedPath, loading, path]);

  const refresh = useCallback(() => load(path), [load, path]);
  const currentDir = path ?? '';

  // ── 选中 ──

  /** 单击只选中（进入目录 / 编辑文件由双击触发）。 */
  const selectOnly = useCallback((target: string | null) => {
    setSelectionState(target === null ? new Set() : new Set([target]));
    setAnchorPath(target);
  }, []);

  /** Ctrl/Cmd 单击：加选或取消一行。 */
  const toggleSelection = useCallback((target: string) => {
    setSelectionState((current) => {
      const next = new Set(current);
      if (next.has(target)) next.delete(target);
      else next.add(target);
      return next;
    });
    setAnchorPath(target);
  }, []);

  /** Shift 连选 / 程序化替换选中集，保留锚点。 */
  const replaceSelection = useCallback((paths: Iterable<string>, anchor: string | null = null) => {
    const next = new Set(paths);
    setSelectionState(next);
    setAnchorPath(anchor ?? (next.size > 0 ? Array.from(next).pop()! : null));
  }, []);

  // ── 导航与回退 ──

  /** 导航并记住当前视图快照（根目录、展开、选中、滚动）。 */
  const navigate = useCallback((nextPath: string | null) => {
    if (path === nextPath) return;
    setHistory((stack) => [...stack, {
      path,
      expanded: expandedSet,
      selection,
      anchorPath,
      scrollTop: scrollRef.current?.scrollTop ?? 0,
    }]);
    pendingScrollTop.current = 0;
    setSelectionState(new Set());
    setAnchorPath(null);
    setStoredPath(nextPath);
  }, [anchorPath, expandedSet, path, selection, setStoredPath]);

  /** 回退到上一个视图快照（而不是固定上级目录）。 */
  const goBack = useCallback(() => {
    const snapshot = history[history.length - 1];
    if (!snapshot) return;
    setHistory(history.slice(0, -1));
    setExpandedSet(new Set(snapshot.expanded));
    setSelectionState(new Set(snapshot.selection));
    setAnchorPath(snapshot.anchorPath);
    pendingScrollTop.current = snapshot.scrollTop;
    setStoredPath(snapshot.path);
  }, [history, setStoredPath]);

  // ── 树形展开 ──

  const retryExpand = useCallback((entry: SshFsEntry) => {
    setChildErrors((current) => {
      const next = { ...current };
      delete next[entry.path];
      return next;
    });
    setChildLoading((current) => new Set([...current, entry.path]));
    void sshFsList(conn.id, entry.path)
      .then((response) => {
        if (alive.current) setChildCache((current) => ({ ...current, [entry.path]: response.entries }));
      })
      .catch(() => {
        if (alive.current) setChildErrors((current) => ({ ...current, [entry.path]: '无法读取目录' }));
      })
      .finally(() => {
        if (!alive.current) return;
        setChildLoading((current) => {
          const next = new Set(current);
          next.delete(entry.path);
          return next;
        });
      });
  }, [conn.id]);

  const toggleExpand = useCallback((entry: SshFsEntry) => {
    setExpandedSet((current) => {
      const next = new Set(current);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      return next;
    });
    if (expandedSet.has(entry.path) || childCache[entry.path] || childLoading.has(entry.path)) return;
    retryExpand(entry);
  }, [childCache, childLoading, expandedSet, retryExpand]);

  // ── 回退历史 ──

  const setUndo = useCallback((next: RemoteUndo[]) => {
    undoStackRef.current = next;
    setUndoStack(next);
  }, []);

  /** 记录一步可回退操作；被挤出历史的暂存删除项永久删除（回退窗口结束）。 */
  const pushUndo = useCallback((entry: RemoteUndo) => {
    const next = [entry, ...undoStackRef.current];
    for (const dropped of next.splice(MAX_UNDO_STEPS)) {
      if (dropped.kind === 'delete') {
        void sshPurgeStaged(conn.id, dropped.pairs.map((pair) => pair.to)).catch(() => {});
      }
    }
    setUndo(next);
  }, [conn.id, setUndo]);

  /** 回退一步后更新栈：全部成功则出栈，部分失败把失败项留在栈顶重试。 */
  const settleUndo = useCallback((current: RemoteUndo, failed: SshOpPair[]) => {
    const rest = undoStackRef.current.slice(1);
    setUndo(failed.length > 0 ? [{ ...current, pairs: failed }, ...rest] : rest);
  }, [setUndo]);

  const runUndo = useCallback(async () => {
    const current = undoStackRef.current[0];
    if (!current) return;
    try {
      if (current.kind === 'delete') {
        const outcome = await sshRestoreStaged(conn.id, current.pairs);
        if (outcome.errors.length > 0) toast(outcome.errors[0]!, 'error');
        if (outcome.completed.length > 0) {
          toast(outcome.completed.length > 1 ? `已回退删除 ${outcome.completed.length} 项` : '已回退删除', 'success');
          replaceSelection(outcome.completed.map((pair) => pair.from));
        }
        const restored = new Set(outcome.completed.map((pair) => pair.from));
        settleUndo(current, current.pairs.filter((pair) => !restored.has(pair.from)));
      } else if (current.kind === 'rename') {
        const failed: SshOpPair[] = [];
        for (const pair of current.pairs) {
          try {
            await sshRename(conn.id, pair.to, pair.from.split('/').pop()!);
          } catch (errorValue) {
            failed.push(pair);
            toast(String((errorValue as Error)?.message ?? errorValue), 'error');
          }
        }
        if (failed.length < current.pairs.length) {
          toast('已回退重命名', 'success');
          replaceSelection(current.pairs.map((pair) => pair.from));
        }
        settleUndo(current, failed);
      } else {
        const failed: SshOpPair[] = [];
        let restored = 0;
        for (const pair of current.pairs) {
          const parent = parentOfRemote(pair.from) ?? '/';
          try {
            await sshMove(conn.id, pair.to, parent);
            restored += 1;
          } catch (errorValue) {
            failed.push(pair);
            toast(String((errorValue as Error)?.message ?? errorValue), 'error');
          }
        }
        if (restored > 0) toast(restored > 1 ? `已回退移动 ${restored} 项` : '已回退移动', 'success');
        replaceSelection(current.pairs.map((pair) => pair.from));
        settleUndo(current, failed);
      }
      refresh();
    } catch (errorValue) {
      toast(String((errorValue as Error)?.message ?? errorValue), 'error');
    }
  }, [conn.id, refresh, replaceSelection, settleUndo, toast]);

  // ── 剪贴板 ──

  const copyEntries = useCallback((list: SshFsEntry[]) => {
    setClipboard({ mode: 'copy', paths: list.map((entry) => entry.path) });
    toast(list.length > 1 ? `已复制 ${list.length} 项` : '已复制');
  }, [toast]);

  const cutEntries = useCallback((list: SshFsEntry[]) => {
    setClipboard({ mode: 'cut', paths: list.map((entry) => entry.path) });
    toast(list.length > 1 ? `已剪切 ${list.length} 项` : '已剪切');
  }, [toast]);

  /** 粘贴到指定目录；剪切是移动（可回退），复制不改变回退记录。 */
  const pasteInto = useCallback(async (destDir: string | null) => {
    if (!clipboard || destDir === null) return;
    try {
      if (clipboard.mode === 'cut') {
        let moved = 0;
        const pairs: SshOpPair[] = [];
        for (const source of clipboard.paths) {
          if (parentOfRemote(source) === destDir) continue;
          const target = joinRemote(destDir, source.split('/').pop()!);
          try {
            await sshMove(conn.id, source, destDir);
            moved += 1;
            pairs.push({ from: source, to: target });
          } catch (errorValue) {
            toast(String((errorValue as Error)?.message ?? errorValue), 'error');
          }
        }
        if (moved > 0) {
          setClipboard(null);
          pushUndo({ kind: 'move', label: '移动', pairs });
          toast(moved > 1 ? `已移动 ${moved} 项` : '已移动', 'success');
          replaceSelection(pairs.map((pair) => pair.to));
        }
      } else {
        const outcome = await sshCopy(conn.id, clipboard.paths, destDir);
        if (outcome.errors.length > 0) toast(outcome.errors[0]!, 'error');
        if (outcome.completed.length > 0) {
          toast(outcome.completed.length > 1 ? `已粘贴 ${outcome.completed.length} 项` : '已粘贴', 'success');
          replaceSelection(outcome.completed.map((pair) => pair.to));
        }
      }
      refresh();
    } catch (errorValue) {
      toast(String((errorValue as Error)?.message ?? errorValue), 'error');
    }
  }, [clipboard, conn.id, pushUndo, refresh, replaceSelection, toast]);

  /** Ctrl+V / 空白处右键：粘贴到当前目录。 */
  const pasteClipboard = useCallback(() => pasteInto(path), [pasteInto, path]);

  // ── 文件操作 ──

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
      pushUndo({ kind: 'rename', label: '重命名', pairs: [{ from: entry.path, to: renamedRemotePath(entry, newName) }] });
      toast('已重命名', 'success');
      refresh();
    } catch (errorValue) {
      toast(String((errorValue as Error)?.message ?? errorValue), 'error');
    }
  }, [conn.id, pushUndo, refresh, toast]);

  /** 删除 = 移到远端暂存（可回退），回退窗口结束或挤出历史后永久删除。 */
  const doDelete = useCallback(async (list: SshFsEntry[]) => {
    try {
      const outcome = await sshStageDelete(conn.id, list.map((entry) => entry.path));
      if (outcome.errors.length > 0) toast(outcome.errors[0]!, 'error');
      if (outcome.completed.length > 0) {
        pushUndo({ kind: 'delete', label: '删除', pairs: outcome.completed });
        toast(
          outcome.completed.length > 1
            ? `已删除 ${outcome.completed.length} 项，可在更多菜单回退`
            : '已删除，可在更多菜单回退',
          'success',
        );
        replaceSelection([]);
      }
      refresh();
    } catch (errorValue) {
      toast(String((errorValue as Error)?.message ?? errorValue), 'error');
    }
  }, [conn.id, pushUndo, refresh, replaceSelection, toast]);

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

  /** 系统文件拖入远程面板：把拖入的本地路径上传到目标目录。 */
  const uploadPaths = useCallback(async (localPaths: string[], remoteDir: string) => {
    let succeeded = 0;
    for (const localPath of localPaths) {
      try {
        await sshUpload(conn.id, remoteDir, localPath);
        succeeded += 1;
      } catch (errorValue) {
        toast(`${localPath}：${String((errorValue as Error)?.message ?? errorValue)}`, 'error');
      }
    }
    if (succeeded > 0) {
      toast(succeeded > 1 ? `已上传 ${succeeded} 项` : '已上传', 'success');
      refresh();
    }
  }, [conn.id, refresh, toast]);

  /** 面板内拖动：把远程条目移动到目标目录（拖拽语义 = 移动，可回退）。 */
  const moveInto = useCallback(async (list: Array<{ path: string }>, destDir: string) => {
    const pairs: SshOpPair[] = [];
    for (const entry of list) {
      if (parentOfRemote(entry.path) === destDir) continue;   // 同级：无操作
      const target = joinRemote(destDir, entry.path.split('/').pop()!);
      try {
        await sshMove(conn.id, entry.path, destDir);
        pairs.push({ from: entry.path, to: target });
      } catch (errorValue) {
        toast(String((errorValue as Error)?.message ?? errorValue), 'error');
      }
    }
    if (pairs.length > 0) {
      pushUndo({ kind: 'move', label: '移动', pairs });
      toast(pairs.length > 1 ? `已移动 ${pairs.length} 项` : '已移动', 'success');
      replaceSelection(pairs.map((pair) => pair.to));
      refresh();
    }
  }, [conn.id, pushUndo, refresh, replaceSelection, toast]);

  /** 拖出窗口前：把远程条目下载到本地（记入下载历史），返回本地路径供系统拖拽。 */
  const downloadForDrag = useCallback(async (list: Array<{ path: string }>): Promise<string[] | null> => {
    toast('正在下载…', 'info');
    const locals: string[] = [];
    for (const entry of list) {
      try {
        locals.push(await sshDownload(conn.id, entry.path));
      } catch (errorValue) {
        toast(String((errorValue as Error)?.message ?? errorValue), 'error');
      }
    }
    if (locals.length === 0) return null;
    toast(locals.length > 1 ? `已下载 ${locals.length} 项` : '已下载', 'success');
    return locals;
  }, [conn.id, toast]);

  // ── 菜单 ──

  const handleContextMenu = useCallback((event: React.MouseEvent, entry: SshFsEntry) => {
    event.preventDefault();
    if (!selection.has(entry.path)) selectOnly(entry.path);
    setCtxMenu({ x: event.clientX, y: event.clientY, entry });
  }, [selectOnly, selection]);

  const closeContextMenu = useCallback(() => setCtxMenu(null), []);
  const closeMoreMenu = useCallback(() => setMoreMenu(null), []);
  const openMoreMenu = useCallback((event: React.MouseEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMoreMenu({ x: rect.left, y: rect.bottom + 4 });
  }, []);

  /** 右键菜单的目标行：命中行属于多选时是整组，否则只有该行。 */
  const targetsFor = useCallback((entry: SshFsEntry): SshFsEntry[] => {
    if (!selection.has(entry.path)) return [entry];
    const byPath = new Map<string, SshFsEntry>();
    const walk = (list: SshFsEntry[]) => {
      for (const item of list) {
        if (selection.has(item.path)) byPath.set(item.path, item);
        const children = childCache[item.path];
        if (children) walk(children);
      }
    };
    walk(entries);
    return byPath.size > 0 ? [...byPath.values()] : [entry];
  }, [childCache, entries, selection]);

  const buildMenuItems = useCallback((entry: SshFsEntry): ContextMenuItem[] => {
    const targets = targetsFor(entry);
    const multi = targets.length > 1;
    const single = targets[0]!;
    const items: ContextMenuItem[] = [
      { label: multi ? `复制 ${targets.length} 项` : '复制', onClick: () => copyEntries(targets) },
      { label: multi ? `剪切 ${targets.length} 项` : '剪切', onClick: () => cutEntries(targets) },
    ];
    if (clipboard && path !== null) {
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
    if (!multi) items.push({ label: single.is_dir ? '下载文件夹到本地' : '下载到本地', onClick: () => void doDownload(single) });
    items.push({
      label: multi ? `删除 ${targets.length} 项` : '删除',
      danger: true,
      onClick: () => setConfirm({ kind: 'delete', entries: targets }),
    });
    return items;
  }, [clipboard, copyEntries, cutEntries, doDownload, pasteInto, path, targetsFor]);

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
    if (current.kind === 'delete') void doDelete(current.entries);
    else void doRename(current.entry, current.newName);
  }, [confirm, doDelete, doRename]);

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

  const cutPaths = useMemo(
    () => (clipboard?.mode === 'cut' ? new Set(clipboard.paths) : new Set<string>()),
    [clipboard],
  );

  return {
    refresh,
    path,
    navigate,
    goBack,
    canGoBack: history.length > 0,
    entries,
    error,
    loading,
    loadedPath,
    selection,
    anchorPath,
    selectOnly,
    toggleSelection,
    replaceSelection,
    expandedSet,
    childCache,
    childLoading,
    childErrors,
    toggleExpand,
    retryExpand,
    scrollRef,
    clipboard,
    cutPaths,
    undo: undoStack[0] ?? null,
    undoCount: undoStack.length,
    runUndo,
    copySelection: copyEntries,
    cutSelection: cutEntries,
    pasteClipboard,
    pasteInto,
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
    syncToTerminal,
    doUpload,
    doUploadDir,
    uploadPaths,
    moveInto,
    downloadForDrag,
  };
}
