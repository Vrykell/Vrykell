import { useCallback, useEffect, useRef, useState } from 'react';
import { readHistoryPage, type HistoryCursor, type HistoryPageRequest } from '@platform/api/historyPage';
import { groupsList } from '@platform/api/group';
import type { BackendGroupEntry, BackendSessionEntry } from '@platform/api/types';
import type { BackendConversation } from '@platform/api/conversation';

export const HISTORY_PAGE_SIZE = 40;
function mergeRows<T extends { id: string }>(previous: T[], next: T[]) {
  return [...new Map([...previous, ...next].map(row => [row.id, row])).values()];
}

export function useHistoryPages(source: HistoryPageRequest['source'], sort: HistoryPageRequest['sort'], revision: string) {
  const [sessions, setSessions] = useState<BackendSessionEntry[]>([]);
  const [conversations, setConversations] = useState<BackendConversation[]>([]);
  const [groups, setGroups] = useState<BackendGroupEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const cursor = useRef<HistoryCursor | null>(null);
  const pending = useRef(false);
  const more = useRef(false);
  const groupsLoaded = useRef(false);
  const load = useCallback(async (reset: boolean) => {
    if (!reset && (pending.current || !more.current)) return;
    const requestId = reset ? ++generation.current : generation.current;
    pending.current = true;
    if (reset) { cursor.current = null; more.current = false; setLoading(true); setLoadingMore(false); }
    else setLoadingMore(true);
    setError('');
    try {
      const [page, nextGroups] = await Promise.all([
        readHistoryPage({ source, sort, limit: HISTORY_PAGE_SIZE, cursor: reset ? null : cursor.current }),
        reset && !groupsLoaded.current ? groupsList() : Promise.resolve(null),
      ]);
      if (requestId !== generation.current) return;
      setSessions(previous => reset ? page.sessions : mergeRows(previous, page.sessions));
      setConversations(previous => reset ? page.conversations : mergeRows(previous, page.conversations));
      if (nextGroups) { setGroups(nextGroups); groupsLoaded.current = true; }
      cursor.current = page.nextCursor;
      more.current = !!page.nextCursor;
      setHasMore(more.current);
    } catch (reason) {
      if (requestId === generation.current) setError(String(reason));
    } finally {
      if (requestId === generation.current) { pending.current = false; setLoading(false); setLoadingMore(false); }
    }
  }, [source, sort, revision]);
  const refresh = useCallback(() => { groupsLoaded.current = false; return load(true); }, [load]);
  useEffect(() => { void load(true); return () => { generation.current += 1; pending.current = false; }; }, [load]);
  return { sessions, conversations, groups, loading, loadingMore, hasMore, error, refresh, loadMore: useCallback(() => load(false), [load]) };
}
