import { useFileUndoSettings } from '@config/fileUndo';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DiskEntry, FsEntry } from '@platform/api/types';
import {
  DEFAULT_DIR_NAME, DEFAULT_FILE_NAME, fileOpsFor, resolveTargetDir,
} from '@features/files/model/fileOps';
import type { FileListResult, FileOpPair, FileOps, FileOpsTarget } from '@features/files/model/fileOps';
import { useToastStore } from '@ui/feedback/Toast';
import { terminalDebug } from '@features/terminal/services/terminalDebug';
import { writeClipboardFiles } from '@platform/clipboard';
import { t, type I18nKey } from '@i18n';

/** State for context menus, rename and the delete confirmation. */
export type FileConfirmState =
  | { kind: 'rename'; entry: FsEntry; newName: string }
  | { kind: 'delete'; entries: FsEntry[] };

/** Clipboard: copy or cut (cut then paste moves and remains undoable). */
export interface FileClipboard {
  mode: 'copy' | 'cut';
  paths: string[];
}

/** The latest undoable file operation (a history stack; the top is the most recent step). */
export interface FileUndo {
  /** rename/move/delete undo by reversing; remove stages the added entries (create and paste). */
  kind: 'rename' | 'move' | 'delete' | 'remove';
  /** i18n key of the operation name (`files.undo.*`). */
  labelKey: I18nKey;
  pairs: FileOpPair[];
}

/** Maximum undo steps; older steps permanently remove their staged deletions. */
const MAX_UNDO_STEPS = 20;

/**
 * A directory's saved view: what the tree showed when the directory was last
 * left. Back, forward and revisits restore this state.
 */
interface ViewSnapshot {
  expanded: ReadonlySet<string>;
  selection: ReadonlySet<string>;
  anchorPath: string | null;
  scrollTop: number;
}

/**
 * One entry of the visit trail: every visited directory appears once, in
 * first-visit order. Navigating to a directory that is already on the trail
 * moves the cursor to its entry instead of appending, so back never replays a
 * branch the user jumped out of.
 */
interface TrailEntry {
  path: string | null;
  view: ViewSnapshot;
}

/** The visit trail plus the cursor position of the directory on screen. */
interface TrailState {
  entries: TrailEntry[];
  cursor: number;
}

/** Beyond this many directories the oldest trail entries are dropped. */
const MAX_TRAIL_ENTRIES = 50;

/**
 * View of a directory that is being entered for the first time: nothing
 * selected and the list at the top (expansion follows the global state).
 */
function freshView(expanded: ReadonlySet<string>): ViewSnapshot {
  return { expanded, selection: new Set(), anchorPath: null, scrollTop: 0 };
}

/**
 * Show the progress hint only when a directory takes longer than this; fast local disks should
 * not flash it.
 */
const LOADING_HINT_DELAY_MS = 150;

export interface UseFileBrowserOptions {
  /** Execution target; keep the reference stable (constant for local, useMemo for SSH). */
  target: FileOpsTarget;
  /** Connect to the backend only while the panel is visible. */
  enabled?: boolean;
  /** Initial directory (local: terminal cwd / null = home; remote: remembered / null = remote home). */
  initialPath?: string | null;
  /** True when `initialPath` is already final: `null` then means the drive view, not "resolve home". */
  initialResolved?: boolean;
  /** Persist directory changes (the remote panel remembers per connection). */
  onPathChange?: (path: string | null) => void;
  /** Open a file on double-click or Enter (local: terminal editor; remote: remote editor). */
  openEntry: (entry: FsEntry) => void;
}

/** Last path segment, for both local and remote separators. */
function pathName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Run on the next frame, falling back to a timer without requestAnimationFrame. */
function schedule(task: () => void) {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(task);
  else setTimeout(task, 16);
}

/**
 * Browsing and operation state shared by the local and SSH file panels.
 *
 * The view depends only on this layer: directory loading, tree expansion, selection, back/forward,
 * clipboard, undo history and new/rename/delete all go through `FileOps` to the matching backend.
 * The `target` alone decides whether the local or remote side is operated on.
 */
export function useFileBrowser({
  target,
  enabled = true,
  initialPath = null,
  initialResolved = false,
  onPathChange,
  openEntry,
}: UseFileBrowserOptions) {
  const ops: FileOps = useMemo(() => fileOpsFor(target), [target]);
  const [trail, setTrail] = useState<TrailState>(() => ({
    entries: [{ path: initialPath, view: freshView(new Set()) }],
    cursor: 0,
  }));
  const path = trail.entries[trail.cursor]?.path ?? null;
  const initialized = useRef(initialPath !== null || initialResolved);
  const requestVersion = useRef(0);
  const navigationVersion = useRef(0);
  const [navigationPending, setNavigationPending] = useState(false);
  const preloaded = useRef<{ path: string | null; result: FileListResult } | null>(null);
  const alive = useRef(true);

  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [disks, setDisks] = useState<DiskEntry[]>([]);
  const [loadedPath, setLoadedPath] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingHint, setLoadingHint] = useState(false);
  const loadingHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const undoEnabled = useFileUndoSettings(state => target.kind === 'ssh' ? state.remote : state.local);
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
      navigationVersion.current += 1;
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

  /** Correct the current entry's path in place; a resolved start directory is not a navigation. */
  const correctPath = useCallback((next: string | null) => {
    setTrail((prev) => ({
      entries: prev.entries.map((entry, index) => (index === prev.cursor ? { ...entry, path: next } : entry)),
      cursor: prev.cursor,
    }));
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
    // Keep the previous list so a fast switch replaces it in place instead of flashing empty.
    const kind = currentPath === null ? 'root' : 'directory';
    terminalDebug('files-load-start', { requestId: version, kind });
    const cached = preloaded.current;
    preloaded.current = null;
    const request = (cached?.path === currentPath ? Promise.resolve(cached.result) : ops.list(currentPath)).then((result) => {
      if (version !== requestVersion.current) return;
      setLoadedPath(currentPath);
      if (currentPath === null && result.base) {
        // The target resolved its own start directory (remote home): correct silently, no trail entry.
        initialized.current = true;
        preloaded.current = { path: result.base, result };
        correctPath(result.base);
      }
      // A null path on the local panel is the disk view (no entries); otherwise use the list.
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
      // Preserve the original error; the remote panel classifies service-unavailable and auth cases.
      setError(String((cause as Error)?.message ?? cause));
      terminalDebug('files-load-error', { requestId: version, kind, errorType: cause instanceof Error ? cause.name : typeof cause });
    }).finally(() => {
      if (version !== requestVersion.current) return;
      clearLoadingTimer();
      setLoading(false);
      setLoadingHint(false);
    });
  }, [clearLoadingTimer, correctPath, ops]);

  // Start directory: use the one given from outside; a local panel without a cwd falls back to home.
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
      correctPath(home);
    }).catch(() => {});
  }, [correctPath, enabled, initialPath, ops]);

  useEffect(() => {
    if (!enabled) return;
    load(path);
    return () => { requestVersion.current += 1; };
  }, [enabled, load, path]);

  // Restore the snapshot scroll position after the target directory loads; earlier commits still
  // belonged to the previous directory.
  useLayoutEffect(() => {
    if (loading || loadedPath !== path || pendingScrollTop.current === null) return;
    const target0 = pendingScrollTop.current;
    pendingScrollTop.current = null;
    if (scrollRef.current) scrollRef.current.scrollTop = target0;
  }, [loadedPath, loading, path]);

  const refresh = useCallback(() => load(path), [load, path]);
  const currentDir = path ?? '';
  const settled = loadedPath === path;

  /** Scroll a path's row into view; list refreshes are async, so retry for a few frames. */
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

  // Selection.

  /** Clicking only selects; double-click enters a directory or opens a file. */
  const selectOnly = useCallback((target1: string | null) => {
    setSelectionState(target1 === null ? new Set() : new Set([target1]));
    setAnchorPath(target1);
  }, []);

  /** Ctrl/Cmd click toggles one row in the selection and moves the anchor to it. */
  const toggleSelection = useCallback((target1: string) => {
    setSelectionState((current) => {
      const next = new Set(current);
      if (next.has(target1)) next.delete(target1);
      else next.add(target1);
      return next;
    });
    setAnchorPath(target1);
  }, []);

  /** Shift range or programmatic selection replacement; keeps the anchor. */
  const replaceSelection = useCallback((paths: Iterable<string>, anchor: string | null = null) => {
    const next = new Set(paths);
    setSelectionState(next);
    setAnchorPath(anchor ?? (next.size > 0 ? Array.from(next).pop()! : null));
  }, []);

  // ── Navigation and the visit trail ──

  /** Save the live view of the entry being left; it is restored on return. */
  const captureView = useCallback((): ViewSnapshot => ({
    expanded: expandedSet,
    selection,
    anchorPath,
    scrollTop: scrollRef.current?.scrollTop ?? 0,
  }), [anchorPath, expandedSet, selection]);

  /** Put a saved view back on screen (the list reloads because `path` changes). */
  const restoreView = useCallback((view: ViewSnapshot) => {
    setExpandedSet(new Set(view.expanded));
    setSelectionState(new Set(view.selection));
    setAnchorPath(view.anchorPath);
    pendingScrollTop.current = view.scrollTop;
  }, []);

  /** Move the cursor to another trail entry: save the live view, then restore the target's. */
  const moveCursor = useCallback((nextCursor: number) => {
    const target = trail.entries[nextCursor];
    if (!target) return;
    navigationVersion.current += 1;
    setNavigationPending(false);
    const snapshot = captureView();
    setTrail((prev) => ({
      entries: prev.entries.map((entry, index) => (index === prev.cursor ? { ...entry, view: snapshot } : entry)),
      cursor: nextCursor,
    }));
    restoreView(target.view);
    onPathChangeRef.current?.(target.path);
  }, [captureView, restoreView, trail.entries]);

  const goBack = useCallback(() => moveCursor(trail.cursor - 1), [moveCursor, trail.cursor]);
  const goForward = useCallback(() => moveCursor(trail.cursor + 1), [moveCursor, trail.cursor]);

  /**
   * Commit navigation only after the destination can be listed.
   *
   * A directory that is already on the trail is a history jump: the cursor
   * moves to its entry and the forward side stays intact. A new directory
   * drops the forward side, becomes the trail head and starts from a blank
   * view.
   */
  const navigate = useCallback(async (nextPath: string | null) => {
    initialized.current = true;
    const version = ++navigationVersion.current;
    if (path === nextPath && !error && settled) { setNavigationPending(false); return true; }
    setNavigationPending(true);
    let result: FileListResult;
    try {
      result = await ops.list(nextPath);
    } catch (cause) {
      if (alive.current && version === navigationVersion.current) {
        toast(`${t('files.error.readDir')}: ${String((cause as Error)?.message ?? cause)}`, 'error');
        terminalDebug('files-navigation-error', { errorType: cause instanceof Error ? cause.name : typeof cause });
      }
      return false;
    } finally {
      if (alive.current && version === navigationVersion.current) setNavigationPending(false);
    }
    if (!alive.current || version !== navigationVersion.current) return false;
    const destination = result.base ?? nextPath;
    preloaded.current = { path: destination, result };
    const target = trail.entries.findIndex((entry) => entry.path === destination);
    const snapshot = captureView();

    if (target !== -1 && target !== trail.cursor) {
      setTrail((prev) => ({
        entries: prev.entries.map((entry, index) => (index === prev.cursor ? { ...entry, view: snapshot } : entry)),
        cursor: target,
      }));
      restoreView(trail.entries[target]!.view);
      onPathChangeRef.current?.(destination);
      return true;
    }
    if (target === trail.cursor) {
      // The path resolved to the directory already on screen: reload it.
      load(destination);
      return true;
    }
    const view = freshView(expandedSet);
    setTrail((prev) => {
      const saved = prev.entries.map((entry, index) => (index === prev.cursor ? { ...entry, view: snapshot } : entry));
      const next = [...saved.slice(0, prev.cursor + 1), { path: destination, view }];
      const entries = next.length > MAX_TRAIL_ENTRIES ? next.slice(next.length - MAX_TRAIL_ENTRIES) : next;
      return { entries, cursor: entries.length - 1 };
    });
    pendingScrollTop.current = 0;
    setSelectionState(new Set());
    setAnchorPath(null);
    onPathChangeRef.current?.(destination);
    return true;
  }, [captureView, error, expandedSet, load, ops, path, restoreView, settled, toast, trail.entries, trail.cursor]);

  // Tree expansion.

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
        if (alive.current) setChildErrors((current) => ({ ...current, [entry.path]: t('files.error.readDir') }));
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

  /** Re-read a directory's children (after a failure or a content change). */
  const refreshDir = useCallback((target1: Pick<FsEntry, 'path'>) => {
    return loadChildren(target1);
  }, [loadChildren]);

  /** Collapse every expanded folder; keep the child cache so expanding again does not re-request. */
  const collapseAll = useCallback(() => {
    setExpandedSet(new Set());
  }, []);

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
   * Refresh every directory affected by a file change: the current list, the changed item's
   * parent and the destination. Refreshing only the root leaves ghosts: stale child caches keep
   * deleted or moved entries on the tree and renamed entries under their old names.
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
      // A directory that was never expanded has no cache; read it when the user expands it.
      if (childCache[dir] === undefined && !expandedSet.has(dir)) continue;
      void refreshDir({ path: dir });
      refreshed += 1;
    }
    terminalDebug('files-dir-refresh', { candidateDirs: dirs.size, refreshedDirs: refreshed });
  }, [childCache, expandedSet, load, ops, path, refreshDir]);

  // Undo history.

  const setUndo = useCallback((next: FileUndo[]) => {
    undoStackRef.current = next;
    setUndoStack(next);
  }, []);

  /** Record an undoable step; staged deletions pushed out of the window are purged permanently. */
  const pushUndo = useCallback((entry: FileUndo) => {
    if (!(target.kind === 'ssh' ? useFileUndoSettings.getState().remote : useFileUndoSettings.getState().local)) return;
    const next = [entry, ...undoStackRef.current];
    for (const dropped of next.splice(MAX_UNDO_STEPS)) {
      if (dropped.kind === 'delete') {
        void ops.purgeStaged(dropped.pairs.map((pair) => pair.to)).catch(() => {});
      }
    }
    setUndo(next);
  }, [ops, setUndo, target.kind]);

  useEffect(() => { if (!undoEnabled) setUndo([]); }, [undoEnabled, setUndo]);

  /** Remove the top step after it is consumed, successful or not. */
  const popUndo = useCallback(() => {
    setUndo(undoStackRef.current.slice(1));
  }, [setUndo]);

  /**
   * Undo one file operation (rename, move or delete); repeatable.
   *
   * Every call consumes the top step: the target may have been moved, deleted or renamed
   * elsewhere, and leaving a failed step on top would leave a counter that can never decrease.
   * A failure therefore reports and removes that step so the count matches what remains.
   */
  const runUndo = useCallback(async () => {
    if (!(target.kind === 'ssh' ? useFileUndoSettings.getState().remote : useFileUndoSettings.getState().local)) return;
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
      } else if (current.kind === 'remove') {
        // Undoing a new item or paste moves the added entries into the staging area.
        const outcome = await ops.stageDelete(current.pairs.map((pair) => pair.to));
        done = outcome.completed.length;
        failed = outcome.errors.length;
        firstError = outcome.errors[0] ?? '';
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
        // Move entries back grouped by their original directory (one operation usually shares one).
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

    const label = t('files.undo.result', { label: t(current.labelKey) });
    if (done > 0) {
      const count = done > 1 ? t('files.undo.countSuffix', { n: done }) : '';
      toast(
        failed > 0 ? t('files.undo.skipped', { base: `${label}${count}`, n: failed }) : `${label}${count}`,
        failed > 0 ? 'info' : 'success',
      );
      replaceSelection(restoredPaths);
    } else if (failed > 0) {
      toast(t('files.undo.failed', { reason: firstError || t('files.undo.reasonMissing') }), 'error');
    }
    // Undo also changes expanded directories: refresh the parents and destinations it touched.
    refreshAffected(current.pairs.flatMap((pair) => [pair.from, pair.to]));
  }, [ops, popUndo, refreshAffected, replaceSelection, toast, target.kind]);

  // Transfers shared by paste and drag.

  /**
   * Copy or move entries into a destination: completed moves become undo steps and the view and
   * destination cache refresh. The backend adds a numbered suffix for duplicate names, so undo
   * records the real destination paths.
   */
  const transferInto = useCallback(async (paths: string[], destDir: string, mode: 'copy' | 'move') => {
    try {
      // Moving into the same directory is a no-op; skip it here so both panels match the backend.
      const sources = mode === 'move' ? paths.filter((source) => ops.parentOf(source) !== destDir) : paths;
      if (sources.length === 0) return;
      const outcome = mode === 'copy' ? await ops.copy(sources, destDir) : await ops.move(sources, destDir);
      terminalDebug('files-op', { op: mode, itemCount: sources.length, doneCount: outcome.completed.length, errorCount: outcome.errors.length });
      if (outcome.completed.length > 0) {
        if (mode === 'move') pushUndo({ kind: 'move', labelKey: 'files.undo.cut', pairs: outcome.completed });
        else pushUndo({ kind: 'remove', labelKey: 'files.undo.paste', pairs: outcome.completed.map((pair) => ({ from: pair.to, to: pair.to })) });
        // Explain an automatically numbered suffix for a duplicate name.
        const renamed = outcome.completed.some((pair) => pathName(pair.to) !== pathName(pair.from));
        const suffixHint = renamed ? t(' (a numbered suffix was added)') : '';
        toast(
          mode === 'copy'
            ? `${t('Copied {{count}} items', { count: outcome.completed.length })}${suffixHint}`
            : `${t('Moved {{count}} items', { count: outcome.completed.length })}${suffixHint}`,
          'success',
        );
        replaceSelection(outcome.completed.map((pair) => pair.to));
        // Expand a destination subdirectory so the pasted entries are visible, then scroll to them.
        if (destDir !== path) setExpandedSet((current) => new Set([...current, destDir]));
        revealPath(outcome.completed[0]!.to);
      }
      if (outcome.errors.length > 0) toast(outcome.errors[0]!, 'error');
      if (outcome.completed.length === 0 && outcome.errors.length === 0) return;
      refreshAffected(sources, destDir);
    } catch (error) {
      toast(String((error as Error)?.message ?? error), 'error');
    }
  }, [ops, pushUndo, refreshAffected, replaceSelection, revealPath, toast]);

  // Clipboard.

  const copyEntries = useCallback((list: FsEntry[]) => {
    const paths = list.map((entry) => entry.path);
    setClipboard({ mode: 'copy', paths });
    // In-panel paste reads the in-memory clipboard; the OS file manager reads the system one.
    void writeClipboardFiles(paths, 'copy').catch(() => {});
    toast(list.length > 1 ? t('Copied {{count}} items', { count: list.length }) : t('Copied'));
  }, [toast]);

  const cutEntries = useCallback((list: FsEntry[]) => {
    const paths = list.map((entry) => entry.path);
    setClipboard({ mode: 'cut', paths });
    void writeClipboardFiles(paths, 'cut').catch(() => {});
    toast(list.length > 1 ? t('Cut {{count}} items', { count: list.length }) : t('Cut to clipboard'));
  }, [toast]);

  /** Paste into a directory; cut pastes as a move (undoable) and copy adds no undo step. */
  const pasteInto = useCallback(async (destDir: string | null) => {
    if (!clipboard || destDir === null) return;
    const mode = clipboard.mode === 'cut' ? 'move' : 'copy';
    if (mode === 'move') setClipboard(null);
    await transferInto(clipboard.paths, destDir, mode);
  }, [clipboard, transferInto]);

  /** Ctrl+V or the blank-area menu pastes into the current directory. */
  const pasteClipboard = useCallback(() => pasteInto(path), [pasteInto, path]);

  const cutPaths = useMemo(
    () => (clipboard?.mode === 'cut' ? new Set(clipboard.paths) : new Set<string>()),
    [clipboard],
  );

  // Create, rename and delete.

  const doRename = useCallback(async (entry: FsEntry, newName: string) => {
    try {
      const finalPath = await ops.rename(entry.path, newName);
      terminalDebug('files-op', { op: 'rename', doneCount: 1, errorCount: 0 });
      pushUndo({ kind: 'rename', labelKey: 'files.undo.rename', pairs: [{ from: entry.path, to: finalPath }] });
      toast(t('Renamed'), 'success');
      replaceSelection([finalPath]);
      // A renamed entry may live in an expanded subdirectory; refresh its parent cache too.
      refreshAffected([entry.path, finalPath]);
    } catch (error) {
      toast(String((error as Error)?.message ?? error), 'error');
    }
  }, [ops, pushUndo, refreshAffected, replaceSelection, toast]);

  /**
   * Create a file or folder: the hit row decides the location (inside a folder, beside a file, or
   * the current directory for blank space), then rename starts immediately.
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
      // Creation is undoable: the overflow menu's undo moves the new entry into staging.
      pushUndo({ kind: 'remove', labelKey: 'files.undo.create', pairs: [{ from: created, to: created }] });
      if (targetEntry?.is_dir) {
        // Created inside a folder: expand it and refresh its children so the entry is visible.
        setExpandedSet((current) => new Set([...current, targetEntry.path]));
        await loadChildren(targetEntry);
      } else {
        load(path);
        if (dir !== path) {
          // The hit row is a file inside an expanded directory, so the new entry lands in that
          // subdirectory. Refreshing only the root would leave the old child cache in place.
          setExpandedSet((current) => new Set([...current, dir]));
          void loadChildren({ path: dir });
        }
      }
      replaceSelection([created]);
      setRenameTarget(entry);
      revealPath(created);
      const defaultName = kind === 'file' ? DEFAULT_FILE_NAME : DEFAULT_DIR_NAME;
      const createdLabel = t(kind === 'dir' ? 'Created folder' : 'Created file');
      toast(`${createdLabel}${entry.name !== defaultName ? t(' (a numbered suffix was added)') : ''}`, 'success');
    } catch (error) {
      toast(String((error as Error)?.message ?? error), 'error');
    }
  }, [load, loadChildren, ops, path, pushUndo, replaceSelection, revealPath, toast]);

  /**
   * Finish a successful drag out of the window: the system accepted the entries as a move, so the
   * source is removed on both local and remote sides and becomes an undo step. On the same drive
   * the system may already have moved it, in which case the staged request fails because the
   * source no longer exists; that case is skipped quietly.
   */
  const removeAfterTransfer = useCallback(async (entries: FsEntry[]) => {
    if (entries.length === 0) return;
    try {
      const outcome = await ops.stageDelete(entries.map((entry) => entry.path));
      terminalDebug('files-op', { op: 'move-out', itemCount: entries.length, doneCount: outcome.completed.length, errorCount: outcome.errors.length });
      if (outcome.completed.length > 0) {
        pushUndo({ kind: 'delete', labelKey: 'files.undo.moveOut', pairs: outcome.completed });
        toast(
          !undoEnabled ? t('Moved to the system without application undo') : outcome.completed.length > 1
            ? t('Moved {{count}} items to the system; undo from the More menu.', { count: outcome.completed.length })
            : t('Moved to the system; undo from the More menu.'),
          'success',
        );
        replaceSelection([]);
      }
      refreshAffected(entries.map((entry) => entry.path));
    } catch (error) {
      // Failure usually means the system already moved the source away; keep the log, not a dialog.
      terminalDebug('files-op', { op: 'move-out-failed', itemCount: entries.length, errorType: (error as Error)?.name ?? typeof error });
      refreshAffected(entries.map((entry) => entry.path));
    }
  }, [ops, pushUndo, refreshAffected, replaceSelection, toast, undoEnabled]);

  /** Delete moves entries into staging (undoable); the history window or eviction purges them. */
  const doDelete = useCallback(async (list: FsEntry[]) => {
    try {
      const outcome = await ops.stageDelete(list.map((entry) => entry.path));
      terminalDebug('files-op', { op: 'delete', itemCount: list.length, doneCount: outcome.completed.length, errorCount: outcome.errors.length });
      if (outcome.errors.length > 0) toast(outcome.errors[0]!, 'error');
      if (outcome.completed.length > 0) {
        pushUndo({ kind: 'delete', labelKey: 'files.undo.delete', pairs: outcome.completed });
        toast(
          !undoEnabled ? t('Deleted without application undo') : outcome.completed.length > 1
            ? t('Deleted {{count}} items; undo from the More menu.', { count: outcome.completed.length })
            : t('Deleted; undo from the More menu.'),
          'success',
        );
        replaceSelection([]);
      }
      // Deleted entries may live in expanded subdirectories; refresh their parents to avoid ghosts.
      refreshAffected(outcome.completed.map((pair) => pair.from));
    } catch (error) {
      toast(String((error as Error)?.message ?? error), 'error');
    }
  }, [ops, pushUndo, refreshAffected, replaceSelection, toast, undoEnabled]);

  // Menus and confirmation.

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

  /** Open the rename input (from the menu or right after creation) and scroll the row into view. */
  const startRename = useCallback((entry: FsEntry) => {
    setRenameTarget(entry);
    revealPath(entry.path);
  }, [revealPath]);

  /** Open the delete confirmation (menu entry). */
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
    navigationPending,
    loadingHint,
    error,
    refresh,
    load,
    navigate,
    goBack,
    goForward,
    canGoBack: trail.cursor > 0,
    canGoForward: trail.cursor < trail.entries.length - 1,
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
    undo: undoEnabled ? undoStack[0] ?? null : null,
    undoCount: undoStack.length,
    runUndo,
    copySelection: copyEntries,
    cutSelection: cutEntries,
    pasteClipboard,
    pasteInto,
    transferInto,
    createEntry,
    removeAfterTransfer,
    collapseAll,
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
