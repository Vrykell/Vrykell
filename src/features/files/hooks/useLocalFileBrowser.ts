import { useCallback, useEffect, useRef, useState } from 'react';
import { fsDisks, fsHome, fsList, type DiskEntry, type FsEntry } from '@features/files/services/fs';
import { normPath } from '@features/files/utils/pathUtils';
import { terminalDebug } from '@features/terminal/services/terminalDebug';

interface UseLocalFileBrowserOptions {
  activeCwd?: string;
  focusedPaneId?: string;
}

/** Load local directories and keep navigation results associated with their requests. */
export function useLocalFileBrowser({ activeCwd, focusedPaneId }: UseLocalFileBrowserOptions) {
  const [path, setPath] = useState<string | null>(() => activeCwd ? normPath(activeCwd) : null);
  const [homePath, setHomePath] = useState<string | null>(null);
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
    fsHome().then((home) => setHomePath(normPath(home))).catch(() => setHomePath(null));
  }, []);

  const followedPath = activeCwd ? normPath(activeCwd) : homePath;
  useEffect(() => {
    setPath(followedPath);
  }, [followedPath, focusedPaneId]);

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
    void request.catch((cause: unknown) => {
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
    setPath,
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
