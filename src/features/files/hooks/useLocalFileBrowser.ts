import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fsDisks, fsHome, fsList, type DiskEntry, type FsEntry } from '@features/files/services/fs';
import { normPath } from '@features/files/utils/pathUtils';
import { terminalDebug } from '@features/terminal/services/terminalDebug';

interface UseLocalFileBrowserOptions {
  initialCwd?: string;
}

interface BrowserViewMemory {
  selectedPath: string | null;
  scrollTop: number;
}

/** Remember each directory's selected row and scroll offset while browsing away. */
const memoryKey = (target: string | null) => target ?? '__disks__';

/** Load local directories and keep navigation results associated with their requests. */
export function useLocalFileBrowser({ initialCwd }: UseLocalFileBrowserOptions) {
  const [path, setBrowserPath] = useState<string | null>(() => initialCwd ? normPath(initialCwd) : null);
  const initialized = useRef(Boolean(initialCwd));
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loadedPath, setLoadedPath] = useState<string | null | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const viewMemory = useRef(new Map<string, BrowserViewMemory>());
  const pendingScrollTop = useRef<number | null>(null);
  const currentView = useRef({ path, selectedPath });
  useEffect(() => {
    currentView.current = { path, selectedPath };
  }, [path, selectedPath]);
  /**
   * Navigate and restore the target directory's last selection and scroll.
   * The scroll offset is applied once the target directory finishes loading.
   */
  const navigate = useCallback((nextPath: string | null) => {
    initialized.current = true;
    const current = currentView.current;
    if (current.path === nextPath) return;
    viewMemory.current.set(memoryKey(current.path), {
      selectedPath: current.selectedPath,
      scrollTop: scrollRef.current?.scrollTop ?? 0,
    });
    const restored = viewMemory.current.get(memoryKey(nextPath));
    pendingScrollTop.current = restored?.scrollTop ?? 0;
    setSelectedPath(restored?.selectedPath ?? null);
    setBrowserPath(nextPath);
  }, []);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [disks, setDisks] = useState<DiskEntry[]>([]);
  const [expandedSet, setExpandedSet] = useState<ReadonlySet<string>>(new Set());
  const [childCache, setChildCache] = useState<Record<string, FsEntry[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [childErrors, setChildErrors] = useState<Record<string, string>>({});
  const [childLoading, setChildLoading] = useState<ReadonlySet<string>>(new Set());
  const requestVersion = useRef(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; requestVersion.current += 1; };
  }, []);

  useEffect(() => {
    if (initialized.current) return;
    // Seed the browser once; later terminal cwd changes cannot interrupt navigation.
    void fsHome().then((home) => {
      if (alive.current && !initialized.current) {
        initialized.current = true;
        setBrowserPath(normPath(home));
      }
    }).catch(() => {});
  }, []);

  const load = useCallback((currentPath: string | null) => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    setEntries([]);
    setDisks([]);
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
      setLoading(false);
      terminalDebug('files-load-end', { requestId: version, kind });
    });
  }, []);

  useEffect(() => {
    load(path);
    return () => { requestVersion.current += 1; };
  }, [load, path]);

  // Restore the remembered scroll offset only once the target directory's own
  // entries are in the DOM; earlier commits still show the previous directory.
  useLayoutEffect(() => {
    if (loading || loadedPath !== path || pendingScrollTop.current === null) return;
    const target = pendingScrollTop.current;
    pendingScrollTop.current = null;
    if (scrollRef.current) scrollRef.current.scrollTop = target;
  }, [loadedPath, loading, path]);

  const retryExpand = useCallback((entry: FsEntry) => {
    setChildErrors((current) => {
      const next = { ...current };
      delete next[entry.path];
      return next;
    });
    setChildLoading((current) => new Set([...current, entry.path]));
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
        setChildLoading((current) => {
          const next = new Set(current);
          next.delete(entry.path);
          return next;
        });
      });
  }, []);

  const toggleExpand = useCallback((entry: FsEntry) => {
    setExpandedSet((current) => {
      const next = new Set(current);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      return next;
    });
    if (expandedSet.has(entry.path) || childCache[entry.path] || childLoading.has(entry.path)) return;
    retryExpand(entry);
  }, [childCache, childLoading, expandedSet, retryExpand]);

  return {
    path,
    navigate,
    selectedPath,
    setSelectedPath,
    scrollRef,
    entries,
    disks,
    expandedSet,
    childCache,
    loading,
    error,
    childErrors,
    childLoading,
    load,
    toggleExpand,
    retryExpand,
  };
}
