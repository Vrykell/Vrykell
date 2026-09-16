import { useCallback, useEffect, useState } from 'react';
import { fsDisks, fsHome, fsList, type DiskEntry, type FsEntry } from '@features/files/services/fs';
import { normPath } from '@features/files/utils/pathUtils';

interface UseLocalFileBrowserOptions {
  activeCwd?: string;
  focusedPaneId?: string;
}

/** 管理本地文件浏览的数据加载、目录树展开和当前路径跟随。 */
export function useLocalFileBrowser({ activeCwd, focusedPaneId }: UseLocalFileBrowserOptions) {
  const [path, setPath] = useState<string | null>(null);
  const [homePath, setHomePath] = useState<string | null>(null);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [disks, setDisks] = useState<DiskEntry[]>([]);
  const [expandedSet, setExpandedSet] = useState<ReadonlySet<string>>(new Set());
  const [childCache, setChildCache] = useState<Record<string, FsEntry[]>>({});

  useEffect(() => {
    fsHome().then((home) => setHomePath(normPath(home))).catch(() => setHomePath(null));
  }, []);

  useEffect(() => {
    setPath(activeCwd ? normPath(activeCwd) : homePath);
  }, [activeCwd, focusedPaneId, homePath]);

  const load = useCallback((currentPath: string | null) => {
    if (currentPath === null) {
      setEntries([]);
      fsDisks().then(setDisks).catch(() => setDisks([]));
      return;
    }
    fsList(currentPath).then(setEntries).catch(() => setEntries([]));
  }, []);

  useEffect(() => {
    load(path);
  }, [load, path]);

  const toggleExpand = useCallback((entry: FsEntry) => {
    setExpandedSet((current) => {
      const next = new Set(current);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      return next;
    });
    if (childCache[entry.path]) return;
    fsList(entry.path)
      .then((children) => setChildCache((current) => ({ ...current, [entry.path]: children })))
      .catch(() => setChildCache((current) => ({ ...current, [entry.path]: [] })));
  }, [childCache]);

  return {
    path,
    setPath,
    entries,
    disks,
    expandedSet,
    childCache,
    load,
    toggleExpand,
  };
}
