import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DiskEntry, FsEntry } from '@platform/api/types';
import {
  DEFAULT_DIR_NAME, DEFAULT_FILE_NAME, fileOpsFor, resolveTargetDir,
} from '@features/files/model/fileOps';
import type { FileOpPair, FileOps, FileOpsTarget } from '@features/files/model/fileOps';
import { useToastStore } from '@ui/Toast';
import { terminalDebug } from '@features/terminal/services/terminalDebug';

/** 右键菜单 / 重命名 / 删除确认的状态。 */
export type FileConfirmState =
  | { kind: 'rename'; entry: FsEntry; newName: string }
  | { kind: 'delete'; entries: FsEntry[] };

/** 剪贴板：复制或剪切（剪切粘贴 = 移动，可回退）。 */
export interface FileClipboard {
  mode: 'copy' | 'cut';
  paths: string[];
}

/** 最近一次文件操作的回退记录（历史栈，栈顶是最近一步）。 */
export interface FileUndo {
  kind: 'rename' | 'move' | 'delete';
  label: string;
  pairs: FileOpPair[];
}

/** 回退历史最多保留的步数（更早的步进会把暂存删除项永久清理）。 */
const MAX_UNDO_STEPS = 20;

/** 视图快照：回退按钮回到上一个文件树视图。 */
interface ViewSnapshot {
  path: string | null;
  expanded: ReadonlySet<string>;
  selection: ReadonlySet<string>;
  anchorPath: string | null;
  scrollTop: number;
}

/**
 * 目录加载超过这个时间才显示进度提示：本地磁盘等快速加载不会闪一下提示。
 */
const LOADING_HINT_DELAY_MS = 150;

export interface UseFileBrowserOptions {
  /** 执行目标（需保持引用稳定：local 用常量，ssh 用 useMemo）。 */
  target: FileOpsTarget;
  /** 面板可见时才连接后端。 */
  enabled?: boolean;
  /** 初始目录（本地：终端 cwd / null = 主目录；远程：记忆的目录 / null = 远端主目录）。 */
  initialPath?: string | null;
  /** 目录变化时持久化（远程面板按连接记忆目录）。 */
  onPathChange?: (path: string | null) => void;
  /** 双击 / Enter 打开文件（本地：终端编辑器；远程：远端编辑器）。 */
  openEntry: (entry: FsEntry) => void;
}

/** 路径末段名称（本地 / 远端分隔符都适用）。 */
function pathName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** 下一帧执行（环境没有 rAF 时退回定时器）。 */
function schedule(task: () => void) {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(task);
  else setTimeout(task, 16);
}

/**
 * useFileBrowser — 本地与 SSH 文件面板共用的浏览与操作状态机。
 *
 * 视图层只依赖这一套：目录加载、树形展开、选中、视图回退、剪贴板、
 * 回退历史与新建 / 重命名 / 删除都通过 `FileOps` 交给对应后端实现，
 * 「操作本地还是远端」只由 `target` 决定，不再有两套并行的面板逻辑。
 */
export function useFileBrowser({
  target,
  enabled = true,
  initialPath = null,
  onPathChange,
  openEntry,
}: UseFileBrowserOptions) {
  const ops: FileOps = useMemo(() => fileOpsFor(target), [target]);
  const [path, setPath] = useState<string | null>(initialPath);
  const initialized = useRef(initialPath !== null);
  const requestVersion = useRef(0);
  const alive = useRef(true);

  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [disks, setDisks] = useState<DiskEntry[]>([]);
  const [loadedPath, setLoadedPath] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingHint, setLoadingHint] = useState(false);
  const loadingHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [history, setHistory] = useState<ViewSnapshot[]>([]);
  const [selection, setSelectionState] = useState<ReadonlySet<string>>(new Set());
  const [anchorPath, setAnchorPath] = useState<string | null>(null);
  const [expandedSet, setExpandedSet] = useState<ReadonlySet<string>>(new Set());
  const [childCache, setChildCache] = useState<Record<string, FsEntry[]>>({});
  const [childErrors, setChildErrors] = useState<Record<string, string>>({});
  const [childPending, setChildPending] = useState<ReadonlySet<string>>(new Set());
  const [childLoadingHint, setChildLoadingHint] = useState<ReadonlySet<string>>(new Set());
  const childHintTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollTop = useRef<number | null>(null);
  const [clipboard, setClipboard] = useState<FileClipboard | null>(null);
  const [undoStack, setUndoStack] = useState<FileUndo[]>([]);
  const undoStackRef = useRef<FileUndo[]>([]);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; entry: FsEntry } | null>(null);
  const [renameTarget, setRenameTarget] = useState<FsEntry | null>(null);
  const [confirm, setConfirm] = useState<FileConfirmState | null>(null);
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null);
  const [blankMenu, setBlankMenu] = useState<{ x: number; y: number } | null>(null);

  const toast = useCallback((message: string, type: 'info' | 'success' | 'error' = 'info') => {
    useToastStore.getState().addToast(message, type);
  }, []);

  const clearLoadingTimer = useCallback(() => {
    if (loadingHintTimer.current !== null) {
      clearTimeout(loadingHintTimer.current);
      loadingHintTimer.current = null;
    }
  }, []);

  const clearChildTimer = useCallback((entryPath: string) => {
    const timer = childHintTimers.current.get(entryPath);
    if (timer !== undefined) {
      clearTimeout(timer);
      childHintTimers.current.delete(entryPath);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      requestVersion.current += 1;
      clearLoadingTimer();
      for (const timer of childHintTimers.current.values()) clearTimeout(timer);
      childHintTimers.current.clear();
    };
  }, [clearLoadingTimer]);

  /**
   * Remember the current directory (the remote panel persists it per connection).
   * The callback is held in a ref: callers pass inline arrows, and letting that
   * identity into `load` would refetch the whole tree on every unrelated
   * re-render, such as resizing the panel that hosts the tree.
   */
  const onPathChangeRef = useRef(onPathChange);
  onPathChangeRef.current = onPathChange;
  const rememberPath = useCallback((next: string | null) => {
    setPath(next);
    onPathChangeRef.current?.(next);
  }, []);

  const load = useCallback((currentPath: string | null) => {
    const version = ++requestVersion.current;
    setLoading(true);
    setLoadingHint(false);
    clearLoadingTimer();
    loadingHintTimer.current = setTimeout(() => {
      loadingHintTimer.current = null;
      if (alive.current && version === requestVersion.current) setLoadingHint(true);
    }, LOADING_HINT_DELAY_MS);
    setError(null);
    // 保留上一份列表，快速切换时原地替换而不是先闪成空白
    const kind = currentPath === null ? 'root' : 'directory';
    terminalDebug('files-load-start', { requestId: version, kind });
    const request = ops.list(currentPath).then((result) => {
      if (version !== requestVersion.current) return;
      setLoadedPath(currentPath);
      if (currentPath === null && result.base) {
        // 目标自己解析出的起始目录（远端主目录）：静默修正，不进入回退历史
        initialized.current = true;
        rememberPath(result.base);
      }
      // 本地面板的 null 路径是磁盘视图（条目为空）；其余情况直接用列表结果
      const showDisks = currentPath === null && ops.disks !== undefined;
      setEntries(showDisks ? [] : result.entries);
      terminalDebug('files-load-end', { requestId: version, kind, entryCount: result.entries.length });
      return result.entries;
    });
    if (currentPath === null && ops.disks) {
      void ops.disks().then((list) => {
        if (version === requestVersion.current) setDisks(list);
      }).catch(() => {});
    }
    void request.catch((cause: unknown) => {
      if (version !== requestVersion.current) return;
      // 保留原始错误：远程面板据此区分「文件服务不可用 / 需要认证」等情况
      setError(String((cause as Error)?.message ?? cause));
      terminalDebug('files-load-error', { requestId: version, kind, errorType: cause instanceof Error ? cause.name : typeof cause });
    }).finally(() => {
      if (version !== requestVersion.current) return;
      clearLoadingTimer();
      setLoading(false);
      setLoadingHint(false);
    });
  }, [clearLoadingTimer, ops, rememberPath]);

  // 初始目录：外部给定则直接用；本地面板未给定 cwd 时落到主目录
  useEffect(() => {
    if (!enabled || initialized.current) return;
    if (initialPath !== null) {
      initialized.current = true;
      return;
    }
    if (!ops.home) return;
    void ops.home().then((home) => {
      if (!alive.current || initialized.current) return;
      initialized.current = true;
      rememberPath(home);
    }).catch(() => {});
  }, [enabled, initialPath, ops, rememberPath]);

  useEffect(() => {
    if (!enabled) return;
    load(path);
    return () => { requestVersion.current += 1; };
  }, [enabled, load, path]);

  // 挂载时清掉上一次会话残留的暂存项（可回退窗口已结束；远端需要，本地由后端启动时清理）
  useEffect(() => {
    if (!enabled || !ops.sweepUndo) return;
    void ops.sweepUndo().catch(() => {});
  }, [enabled, ops]);

  // 目标目录加载完成后还原快照里的滚动位置（此前的提交仍是上一个目录）
  useLayoutEffect(() => {
    if (loading || loadedPath !== path || pendingScrollTop.current === null) return;
    const target0 = pendingScrollTop.current;
    pendingScrollTop.current = null;
    if (scrollRef.current) scrollRef.current.scrollTop = target0;
  }, [loadedPath, loading, path]);

  const refresh = useCallback(() => load(path), [load, path]);
  const currentDir = path ?? '';
  const settled = loadedPath === path;

  /** 把某个路径的行滚入视野（列表刷新是异步的，按帧重试几次）。 */
  const revealPath = useCallback((target: string) => {
    let attempts = 0;
    const step = () => {
      const container = scrollRef.current;
      if (container) {
        const element = Array.from(container.querySelectorAll<HTMLElement>('[data-file-row]'))
          .find((candidate) => candidate.dataset.path === target);
        if (element) {
          if (typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'nearest' });
          return;
        }
      }
      attempts += 1;
      if (attempts < 20 && alive.current) schedule(step);
    };
    schedule(step);
  }, []);

  // ── 选中 ──

  /** 单击只选中（进入目录 / 打开文件由双击触发）。 */
  const selectOnly = useCallback((target1: string | null) => {
    setSelectionState(target1 === null ? new Set() : new Set([target1]));
    setAnchorPath(target1);
  }, []);

  /** Ctrl/Cmd 单击：加选或取消一行。 */
  const toggleSelection = useCallback((target1: string) => {
    setSelectionState((current) => {
      const next = new Set(current);
      if (next.has(target1)) next.delete(target1);
      else next.add(target1);
      return next;
    });
    setAnchorPath(target1);
  }, []);

  /** Shift 连选 / 程序化替换选中集，保留锚点。 */
  const replaceSelection = useCallback((paths: Iterable<string>, anchor: string | null = null) => {
    const next = new Set(paths);
    setSelectionState(next);
    setAnchorPath(anchor ?? (next.size > 0 ? Array.from(next).pop()! : null));
  }, []);

  // ── 导航与视图回退 ──

  /** 导航并记住当前视图快照（目录、展开、选中、滚动）。 */
  const navigate = useCallback((nextPath: string | null) => {
    initialized.current = true;
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
    rememberPath(nextPath);
  }, [anchorPath, expandedSet, path, rememberPath, selection]);

  /** 回退到上一个视图快照（而不是固定上级目录）。 */
  const goBack = useCallback(() => {
    const snapshot = history[history.length - 1];
    if (!snapshot) return;
    setHistory(history.slice(0, -1));
    setExpandedSet(new Set(snapshot.expanded));
    setSelectionState(new Set(snapshot.selection));
    setAnchorPath(snapshot.anchorPath);
    pendingScrollTop.current = snapshot.scrollTop;
    rememberPath(snapshot.path);
  }, [history, rememberPath]);

  // ── 树形展开 ──

  const loadChildren = useCallback((entry: Pick<FsEntry, 'path'>) => {
    terminalDebug('files-tree-load-start', {});
    setChildErrors((current) => {
      const next = { ...current };
      delete next[entry.path];
      return next;
    });
    setChildPending((current) => new Set([...current, entry.path]));
    clearChildTimer(entry.path);
    childHintTimers.current.set(entry.path, setTimeout(() => {
      childHintTimers.current.delete(entry.path);
      if (alive.current) setChildLoadingHint((current) => new Set([...current, entry.path]));
    }, LOADING_HINT_DELAY_MS));
    return ops.list(entry.path)
      .then((result) => {
        if (alive.current) setChildCache((current) => ({ ...current, [entry.path]: result.entries }));
        terminalDebug('files-tree-load-end', { entryCount: result.entries.length });
        return result.entries;
      })
      .catch((cause: unknown) => {
        if (alive.current) setChildErrors((current) => ({ ...current, [entry.path]: '无法读取目录' }));
        terminalDebug('files-tree-load-error', { errorType: cause instanceof Error ? cause.name : typeof cause });
        return undefined;
      })
      .finally(() => {
        if (!alive.current) return;
        clearChildTimer(entry.path);
        setChildPending((current) => {
          if (!current.has(entry.path)) return current;
          const next = new Set(current);
          next.delete(entry.path);
          return next;
        });
        setChildLoadingHint((current) => {
          if (!current.has(entry.path)) return current;
          const next = new Set(current);
          next.delete(entry.path);
          return next;
        });
      });
  }, [clearChildTimer, ops]);

  /** 重新读取某个目录的子列表（失败重试、内容变动后刷新）。 */
  const refreshDir = useCallback((target1: Pick<FsEntry, 'path'>) => {
    return loadChildren(target1);
  }, [loadChildren]);

  const toggleExpand = useCallback((entry: FsEntry) => {
    setExpandedSet((current) => {
      const next = new Set(current);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      return next;
    });
    if (expandedSet.has(entry.path) || childCache[entry.path] || childPending.has(entry.path)) return;
    void loadChildren(entry);
  }, [childCache, childPending, expandedSet, loadChildren]);

  /**
   * 文件变更后刷新受影响的目录：当前目录列表 + 变更项的父目录 + 目标目录。
   * 只刷新根列表会留下「幽灵条目」——已展开子目录里的旧内容还留在 childCache 中，
   * 于是被删除/移动的条目仍在树上、改名后的条目仍显示旧名字。
   */
  const refreshAffected = useCallback((touched: Array<string | null | undefined>, destDir?: string | null) => {
    const dirs = new Set<string>();
    for (const item of touched) {
      if (!item) continue;
      const parent = ops.parentOf(item);
      if (parent) dirs.add(parent);
    }
    if (destDir) dirs.add(destDir);
    load(path);
    let refreshed = 0;
    for (const dir of dirs) {
      // 未展开过的目录没有缓存，等用户展开时再读
      if (childCache[dir] === undefined && !expandedSet.has(dir)) continue;
      void refreshDir({ path: dir });
      refreshed += 1;
    }
    terminalDebug('files-dir-refresh', { candidateDirs: dirs.size, refreshedDirs: refreshed });
  }, [childCache, expandedSet, load, ops, path, refreshDir]);

  // ── 回退历史 ──

  const setUndo = useCallback((next: FileUndo[]) => {
    undoStackRef.current = next;
    setUndoStack(next);
  }, []);

  /** 记录一步可回退操作；被挤出历史的暂存删除项永久清理（回退窗口结束）。 */
  const pushUndo = useCallback((entry: FileUndo) => {
    const next = [entry, ...undoStackRef.current];
    for (const dropped of next.splice(MAX_UNDO_STEPS)) {
      if (dropped.kind === 'delete') {
        void ops.purgeStaged(dropped.pairs.map((pair) => pair.to)).catch(() => {});
      }
    }
    setUndo(next);
  }, [ops, setUndo]);

  /** 该步被消耗后出栈（无论成功与否）。 */
  const popUndo = useCallback(() => {
    setUndo(undoStackRef.current.slice(1));
  }, [setUndo]);

  /**
   * 回退一步文件操作（重命名 / 移动 / 删除），可连续回退。
   *
   * 每次调用都会消耗掉栈顶这一步：目标可能已在别处被移动 / 删除 / 改名，
   * 若把失败项留在栈顶，菜单会一直显示一个再也退不掉的步数。失败时改为
   * 「提示 + 移除该步」，让计数始终跟着实际剩余步数走。
   */
  const runUndo = useCallback(async () => {
    const current = undoStackRef.current[0];
    if (!current) return;
    let done = 0;
    let failed = 0;
    let firstError = '';
    const restoredPaths: string[] = [];
    try {
      if (current.kind === 'delete') {
        const outcome = await ops.restoreStaged(current.pairs);
        done = outcome.completed.length;
        failed = outcome.errors.length;
        firstError = outcome.errors[0] ?? '';
        restoredPaths.push(...outcome.completed.map((pair) => pair.from));
      } else if (current.kind === 'rename') {
        for (const pair of current.pairs) {
          try {
            restoredPaths.push(await ops.rename(pair.to, pathName(pair.from)));
            done += 1;
          } catch (error) {
            failed += 1;
            firstError ||= String((error as Error)?.message ?? error);
          }
        }
      } else {
        // 按原目录分组移回（同一次操作通常来自同一目录）
        const byParent = new Map<string, FileOpPair[]>();
        for (const pair of current.pairs) {
          const parent = ops.parentOf(pair.from) ?? '/';
          byParent.set(parent, [...(byParent.get(parent) ?? []), pair]);
        }
        for (const [parent, pairs] of byParent) {
          const outcome = await ops.move(pairs.map((pair) => pair.to), parent);
          done += outcome.completed.length;
          failed += outcome.errors.length;
          firstError ||= outcome.errors[0] ?? '';
        }
        restoredPaths.push(...current.pairs.map((pair) => pair.from));
      }
    } catch (error) {
      failed = current.pairs.length;
      firstError ||= String((error as Error)?.message ?? error);
    }

    terminalDebug('files-op', { op: `undo-${current.kind}`, itemCount: current.pairs.length, doneCount: done, errorCount: failed });
    popUndo();

    const label = current.kind === 'delete' ? '已回退删除' : current.kind === 'rename' ? '已回退重命名' : '已回退移动';
    if (done > 0) {
      const count = done > 1 ? ` ${done} 项` : '';
      toast(
        failed > 0 ? `${label}${count}，${failed} 项已不存在（已跳过）` : `${label}${count}`,
        failed > 0 ? 'info' : 'success',
      );
      replaceSelection(restoredPaths);
    } else if (failed > 0) {
      toast(`无法回退：${firstError || '目标可能已在别处被移动或删除'}（该步已从历史移除）`, 'error');
    }
    // 回退同样会改动已展开目录里的内容：按涉及的路径刷新父目录与目标目录
    refreshAffected(current.pairs.flatMap((pair) => [pair.from, pair.to]));
  }, [ops, popUndo, refreshAffected, replaceSelection, toast]);

  // ── 迁移（粘贴 / 拖拽共用） ──

  /**
   * 把条目复制/移动到目标目录：成功项记录回退（移动）、刷新视图与目标文件夹缓存。
   * 后端在重名时自动加序号，回退对使用真实目标路径。
   */
  const transferInto = useCallback(async (paths: string[], destDir: string, mode: 'copy' | 'move') => {
    try {
      // 同级移动是空操作：统一在这里跳过，两个面板与后端语义一致
      const sources = mode === 'move' ? paths.filter((source) => ops.parentOf(source) !== destDir) : paths;
      if (sources.length === 0) return;
      const outcome = mode === 'copy' ? await ops.copy(sources, destDir) : await ops.move(sources, destDir);
      terminalDebug('files-op', { op: mode, itemCount: sources.length, doneCount: outcome.completed.length, errorCount: outcome.errors.length });
      if (outcome.completed.length > 0) {
        if (mode === 'move') pushUndo({ kind: 'move', label: '移动', pairs: outcome.completed });
        // 后端为重名自动加了序号时说明一下，避免用户以为名字被改了
        const renamed = outcome.completed.some((pair) => pathName(pair.to) !== pathName(pair.from));
        const suffixHint = renamed ? '（同名已自动加序号）' : '';
        toast(
          mode === 'copy'
            ? `已复制 ${outcome.completed.length} 项${suffixHint}`
            : `已移动 ${outcome.completed.length} 项${suffixHint}`,
          'success',
        );
        replaceSelection(outcome.completed.map((pair) => pair.to));
      }
      if (outcome.errors.length > 0) toast(outcome.errors[0]!, 'error');
      if (outcome.completed.length === 0 && outcome.errors.length === 0) return;
      refreshAffected(sources, destDir);
    } catch (error) {
      toast(String((error as Error)?.message ?? error), 'error');
    }
  }, [ops, pushUndo, refreshAffected, replaceSelection, toast]);

  // ── 剪贴板 ──

  const copyEntries = useCallback((list: FsEntry[]) => {
    setClipboard({ mode: 'copy', paths: list.map((entry) => entry.path) });
    toast(list.length > 1 ? `已复制 ${list.length} 项` : '已复制');
  }, [toast]);

  const cutEntries = useCallback((list: FsEntry[]) => {
    setClipboard({ mode: 'cut', paths: list.map((entry) => entry.path) });
    toast(list.length > 1 ? `已剪切 ${list.length} 项` : '已剪切');
  }, [toast]);

  /** 粘贴到指定目录；剪切是移动（可回退），复制不改变回退记录。 */
  const pasteInto = useCallback(async (destDir: string | null) => {
    if (!clipboard || destDir === null) return;
    const mode = clipboard.mode === 'cut' ? 'move' : 'copy';
    if (mode === 'move') setClipboard(null);
    await transferInto(clipboard.paths, destDir, mode);
  }, [clipboard, transferInto]);

  /** Ctrl+V / 空白处右键：粘贴到当前目录。 */
  const pasteClipboard = useCallback(() => pasteInto(path), [pasteInto, path]);

  const cutPaths = useMemo(
    () => (clipboard?.mode === 'cut' ? new Set(clipboard.paths) : new Set<string>()),
    [clipboard],
  );

  // ── 新建 / 重命名 / 删除 ──

  const doRename = useCallback(async (entry: FsEntry, newName: string) => {
    try {
      const finalPath = await ops.rename(entry.path, newName);
      terminalDebug('files-op', { op: 'rename', doneCount: 1, errorCount: 0 });
      pushUndo({ kind: 'rename', label: '重命名', pairs: [{ from: entry.path, to: finalPath }] });
      toast('已重命名', 'success');
      replaceSelection([finalPath]);
      // 改名的条目可能位于已展开的子目录里：父目录缓存必须一起刷新，否则仍显示旧名字
      refreshAffected([entry.path, finalPath]);
    } catch (error) {
      toast(String((error as Error)?.message ?? error), 'error');
    }
  }, [ops, pushUndo, refreshAffected, replaceSelection, toast]);

  /**
   * 新建文件 / 文件夹：位置由命中的行决定（文件夹内 / 文件同级 / 空白处=当前目录），
   * 建好后立即进入重命名。
   */
  const createEntry = useCallback(async (kind: 'file' | 'dir', targetEntry: FsEntry | null) => {
    if (path === null) return;
    const dir = resolveTargetDir(targetEntry, path, ops.parentOf);
    try {
      const created = kind === 'file'
        ? await ops.createFile(dir, DEFAULT_FILE_NAME)
        : await ops.createDir(dir, DEFAULT_DIR_NAME);
      terminalDebug('files-op', { op: kind === 'file' ? 'create-file' : 'create-dir', doneCount: 1 });
      const entry: FsEntry = { name: pathName(created), path: created, is_dir: kind === 'dir' };
      if (targetEntry?.is_dir) {
        // 落在目录里：确保该目录已展开并刷新子列表，新条目才可见
        setExpandedSet((current) => new Set([...current, targetEntry.path]));
        await loadChildren(targetEntry);
      } else {
        load(path);
      }
      replaceSelection([created]);
      setRenameTarget(entry);
      revealPath(created);
      const defaultName = kind === 'file' ? DEFAULT_FILE_NAME : DEFAULT_DIR_NAME;
      toast(`${kind === 'dir' ? '已新建文件夹' : '已新建文件'}${entry.name !== defaultName ? '（同名已自动加序号）' : ''}`, 'success');
    } catch (error) {
      toast(String((error as Error)?.message ?? error), 'error');
    }
  }, [load, loadChildren, ops, path, replaceSelection, revealPath, toast]);

  /**
   * 拖出窗口成功后的收尾：系统按「移动」接收了条目，源头（本地 / 远端）同步移除并进回退历史。
   * 同盘拖出时系统可能已经把源移走，此时 staged 请求会失败——这类「已不存在」安静跳过即可。
   */
  const removeAfterTransfer = useCallback(async (entries: FsEntry[]) => {
    if (entries.length === 0) return;
    try {
      const outcome = await ops.stageDelete(entries.map((entry) => entry.path));
      terminalDebug('files-op', { op: 'move-out', itemCount: entries.length, doneCount: outcome.completed.length, errorCount: outcome.errors.length });
      if (outcome.completed.length > 0) {
        pushUndo({ kind: 'delete', label: '移出', pairs: outcome.completed });
        toast(
          outcome.completed.length > 1
            ? `已移动 ${outcome.completed.length} 项到系统，可在更多菜单回退`
            : '已移动到系统，可在更多菜单回退',
          'success',
        );
        replaceSelection([]);
      }
      refreshAffected(entries.map((entry) => entry.path));
    } catch (error) {
      // 失败通常是「源已被系统移走」：不打断用户，只记录日志
      terminalDebug('files-op', { op: 'move-out-failed', itemCount: entries.length, errorType: (error as Error)?.name ?? typeof error });
      refreshAffected(entries.map((entry) => entry.path));
    }
  }, [ops, pushUndo, refreshAffected, replaceSelection, toast]);

  /** 删除 = 移到暂存区（可回退）；回退窗口结束或挤出历史后永久清理。 */
  const doDelete = useCallback(async (list: FsEntry[]) => {
    try {
      const outcome = await ops.stageDelete(list.map((entry) => entry.path));
      terminalDebug('files-op', { op: 'delete', itemCount: list.length, doneCount: outcome.completed.length, errorCount: outcome.errors.length });
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
      // 被删项可能位于已展开的子目录里：刷新父目录缓存，避免残留幽灵条目
      refreshAffected(outcome.completed.map((pair) => pair.from));
    } catch (error) {
      toast(String((error as Error)?.message ?? error), 'error');
    }
  }, [ops, pushUndo, refreshAffected, replaceSelection, toast]);

  // ── 菜单与确认 ──

  const handleContextMenu = useCallback((event: React.MouseEvent, entry: FsEntry) => {
    event.preventDefault();
    if (!selection.has(entry.path)) selectOnly(entry.path);
    setCtxMenu({ x: event.clientX, y: event.clientY, entry });
  }, [selectOnly, selection]);

  const closeContextMenu = useCallback(() => setCtxMenu(null), []);
  const openBlankMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setBlankMenu({ x: event.clientX, y: event.clientY });
  }, []);
  const closeBlankMenu = useCallback(() => setBlankMenu(null), []);
  const closeMoreMenu = useCallback(() => setMoreMenu(null), []);
  const openMoreMenu = useCallback((event: React.MouseEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMoreMenu({ x: rect.left, y: rect.bottom + 4 });
  }, []);

  const requestRename = useCallback((entry: FsEntry, newName: string) => {
    setRenameTarget(null);
    const trimmed = newName.trim();
    if (!trimmed || trimmed === entry.name) return;
    setConfirm({ kind: 'rename', entry, newName: trimmed });
  }, []);

  /** 打开重命名输入框（菜单入口 / 新建后立即重命名）。 */
  const startRename = useCallback((entry: FsEntry) => setRenameTarget(entry), []);

  /** 打开删除确认（菜单入口）。 */
  const confirmDelete = useCallback((entries: FsEntry[]) => {
    if (entries.length === 0) return;
    setConfirm({ kind: 'delete', entries });
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

  return {
    ops,
    path,
    currentDir,
    entries,
    disks,
    loadedPath,
    settled,
    loading,
    loadingHint,
    error,
    refresh,
    load,
    navigate,
    goBack,
    canGoBack: history.length > 0,
    selection,
    anchorPath,
    selectOnly,
    toggleSelection,
    replaceSelection,
    expandedSet,
    childCache,
    childErrors,
    childPending,
    childLoadingHint,
    toggleExpand,
    refreshDir,
    scrollRef,
    revealPath,
    clipboard,
    cutPaths,
    undo: undoStack[0] ?? null,
    undoCount: undoStack.length,
    runUndo,
    copySelection: copyEntries,
    cutSelection: cutEntries,
    pasteClipboard,
    pasteInto,
    transferInto,
    createEntry,
    removeAfterTransfer,
    openEntry,
    ctxMenu,
    handleContextMenu,
    closeContextMenu,
    blankMenu,
    openBlankMenu,
    closeBlankMenu,
    moreMenu,
    openMoreMenu,
    closeMoreMenu,
    renameTarget,
    startRename,
    requestRename,
    cancelRename,
    confirm,
    confirmDelete,
    cancelConfirm,
    confirmAction,
  };
}
