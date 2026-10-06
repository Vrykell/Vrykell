import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fsDisks, fsHome, fsList, type DiskEntry, type FsEntry } from '@platform/api/fs';
import { normPath } from '@platform/path';
import { terminalDebug } from '@features/terminal/services/terminalDebug';

interface UseLocalFileBrowserOptions {
  initialCwd?: string;
}

/** Everything needed to bring the tree back to the view the user left. */
interface BrowserViewSnapshot {
  path: string | null;
  expanded: ReadonlySet<string>;
  selectedPath: string | null;
  scrollTop: number;
}

/**
 * A directory load may settle before this; only slower loads surface a progress
 * hint. Fast loads (local disks, empty folders) therefore never flash a
 * transient message while navigating or expanding.
 */
const LOADING_HINT_DELAY_MS = 150;

/** Load local directories and keep navigation results associated with their requests. */
export function useLocalFileBrowser({ initialCwd }: UseLocalFileBrowserOptions) {
  const [path, setBrowserPath] = useState<string | null>(() => initialCwd ? normPath(initialCwd) : null);
  const initialized = useRef(Boolean(initialCwd));
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loadedPath, setLoadedPath] = useState<string | null | undefined>(undefined);
  const [history, setHistory] = useState<BrowserViewSnapshot[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollTop = useRef<number | null>(null);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [disks, setDisks] = useState<DiskEntry[]>([]);
  const [expandedSet, setExpandedSet] = useState<ReadonlySet<string>>(new Set());
  const [childCache, setChildCache] = useState<Record<string, FsEntry[]>>({});
  const [loading, setLoading] = useState(false);
  const [loadingHint, setLoadingHint] = useState(false);
  const loadingHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [childErrors, setChildErrors] = useState<Record<string, string>>({});
  const [childPending, setChildPending] = useState<ReadonlySet<string>>(new Set());
  const [childLoadingHint, setChildLoadingHint] = useState<ReadonlySet<string>>(new Set());
  const childHintTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const requestVersion = useRef(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      requestVersion.current += 1;
      if (loadingHintTimer.current !== null) clearTimeout(loadingHintTimer.current);
      for (const timer of childHintTimers.current.values()) clearTimeout(timer);
      childHintTimers.current.clear();
    };
  }, []);

  const clearLoadingHintTimer = useCallback(() => {
    if (loadingHintTimer.current !== null) {
      clearTimeout(loadingHintTimer.current);
      loadingHintTimer.current = null;
    }
  }, []);

  const clearChildHintTimer = useCallback((entryPath: string) => {
    const timer = childHintTimers.current.get(entryPath);
    if (timer !== undefined) {
      clearTimeout(timer);
      childHintTimers.current.delete(entryPath);
    }
  }, []);

  useEffect(() => {
    if (initialized.current) return;
    // Seed the browser once; later terminal cwd changes cannot interrupt navigation.
    void fsHome().then((home) => {
      if (alive.current && !initialized.current) {
        initialized.current = true;
        setBrowserPath(home);
      }
    }).catch(() => {});
  }, []);

  const load = useCallback((currentPath: string | null) => {
    const version = ++requestVersion.current;
    setLoading(true);
    setLoadingHint(false);
    clearLoadingHintTimer();
    loadingHintTimer.current = setTimeout(() => {
      loadingHintTimer.current = null;
      if (alive.current && version === requestVersion.current) setLoadingHint(true);
    }, LOADING_HINT_DELAY_MS);
    setError(null);
    // Keep the previous listing on screen while the next one loads: a fast swap
    // replaces the content in place instead of flashing an empty area.
    const kind = currentPath === null ? 'disks' : 'directory';
    terminalDebug('files-load-start', { requestId: version, kind });
    const request = currentPath === null
      ? fsDisks().then((result) => { if (version === requestVersion.current) setDisks(result); })
      : fsList(currentPath).then((result) => { if (version === requestVersion.current) setEntries(result); });
    void request.then(() => {
      if (version === requestVersion.current) setLoadedPath(currentPath);
    }).catch((cause: unknown) => {
      if (version !== requestVersion.current) return;
      setError(currentPath === null ? '无法读取磁盘，请重试' : '无法读取目录，请检查访问权限后重试');
      terminalDebug('files-load-error', { requestId: version, kind, errorType: cause instanceof Error ? cause.name : typeof cause });
    }).finally(() => {
      if (version !== requestVersion.current) return;
      clearLoadingHintTimer();
      setLoading(false);
      setLoadingHint(false);
      terminalDebug('files-load-end', { requestId: version, kind });
    });
  }, [clearLoadingHintTimer]);

  useEffect(() => {
    load(path);
    return () => { requestVersion.current += 1; };
  }, [load, path]);

  // Restore the snapshotted scroll offset only once the target directory's own
  // entries are in the DOM; earlier commits still show the previous directory.
  useLayoutEffect(() => {
    if (loading || loadedPath !== path || pendingScrollTop.current === null) return;
    const target = pendingScrollTop.current;
    pendingScrollTop.current = null;
    if (scrollRef.current) scrollRef.current.scrollTop = target;
  }, [loadedPath, loading, path]);

  /**
   * Navigate and remember the current tree view as a snapshot.
   * Forward navigation always starts the target view at the top with no selection.
   */
  const navigate = useCallback((nextPath: string | null) => {
    initialized.current = true;
    if (path === nextPath) return;
    setHistory((stack) => [...stack, {
      path,
      expanded: expandedSet,
      selectedPath,
      scrollTop: scrollRef.current?.scrollTop ?? 0,
    }]);
    pendingScrollTop.current = 0;
    setSelectedPath(null);
    setBrowserPath(nextPath);
  }, [expandedSet, path, selectedPath]);

  /** Go back to the previous view snapshot: root directory, expansion, selection and scroll. */
  const goBack = useCallback(() => {
    const snapshot = history[history.length - 1];
    if (!snapshot) return;
    setHistory(history.slice(0, -1));
    setExpandedSet(new Set(snapshot.expanded));
    setSelectedPath(snapshot.selectedPath);
    pendingScrollTop.current = snapshot.scrollTop;
    setBrowserPath(snapshot.path);
  }, [history]);

  const retryExpand = useCallback((entry: FsEntry) => {
    setChildErrors((current) => {
      const next = { ...current };
      delete next[entry.path];
      return next;
    });
    setChildPending((current) => new Set([...current, entry.path]));
    clearChildHintTimer(entry.path);
    childHintTimers.current.set(entry.path, setTimeout(() => {
      childHintTimers.current.delete(entry.path);
      if (alive.current) setChildLoadingHint((current) => new Set([...current, entry.path]));
    }, LOADING_HINT_DELAY_MS));
    terminalDebug('files-tree-load-start', {});
    void fsList(entry.path)
      .then((children) => {
        if (alive.current) setChildCache((current) => ({ ...current, [entry.path]: children }));
        terminalDebug('files-tree-load-end', { entryCount: children.length });
      })
      .catch((cause: unknown) => {
        if (alive.current) setChildErrors((current) => ({ ...current, [entry.path]: '无法读取目录' }));
        terminalDebug('files-tree-load-error', { errorType: cause instanceof Error ? cause.name : typeof cause });
      })
      .finally(() => {
        if (!alive.current) return;
        clearChildHintTimer(entry.path);
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
  }, [clearChildHintTimer]);

  const toggleExpand = useCallback((entry: FsEntry) => {
    setExpandedSet((current) => {
      const next = new Set(current);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      return next;
    });
    if (expandedSet.has(entry.path) || childCache[entry.path] || childPending.has(entry.path)) return;
    retryExpand(entry);
  }, [childCache, childPending, expandedSet, retryExpand]);

  return {
    path,
    navigate,
    goBack,
    canGoBack: history.length > 0,
    selectedPath,
    setSelectedPath,
    scrollRef,
    entries,
    disks,
    expandedSet,
    childCache,
    loading,
    loadingHint,
    loadedPath,
    error,
    childErrors,
    childLoadingHint,
    load,
    toggleExpand,
    retryExpand,
  };
}
