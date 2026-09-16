import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listSessions } from '@/api/session';
import { groupDeleteWithSessions, groupRestore, groupsList } from '@/api/group';
import type { BackendGroupEntry, BackendSessionEntry } from '@features/search/types';
import { useSessionStore } from '@entities/session';
import * as sessionManager from '@/lib/sessionManager';
import {
  deriveSessionHistorySections,
  hasSessionHistoryFilter,
  SESSION_DATE_OPTIONS,
  SESSION_TYPE_OPTIONS,
  type SessionHistoryFilter,
} from '@features/session-history/model/sessionHistoryModel';

export type SessionHistoryNotification = (message: string, kind: 'success' | 'error') => void;

export interface UseSessionHistoryOptions {
  notify?: SessionHistoryNotification;
}

export interface SessionHistoryController {
  sessions: BackendSessionEntry[];
  groups: BackendGroupEntry[];
  loading: boolean;
  filter: SessionHistoryFilter;
  setFilter: (patch: Partial<SessionHistoryFilter>) => void;
  load: () => Promise<void>;
  openSession: (session: BackendSessionEntry) => void;
  deleteHistoricalSession: (session: BackendSessionEntry) => void;
  restoreGroup: (group: BackendGroupEntry) => Promise<void>;
  deleteGroup: (group: BackendGroupEntry) => Promise<void>;
  historical: BackendSessionEntry[];
  grouped: Map<string, BackendSessionEntry[]>;
  ungrouped: BackendSessionEntry[];
  hasFilter: boolean;
}

const FILTER_KEY = 'vrykell-session-history-filter';
const noopNotify: SessionHistoryNotification = () => {};

function loadFilter(): SessionHistoryFilter {
  try {
    const raw = sessionStorage.getItem(FILTER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SessionHistoryFilter>;
      return {
        query: typeof parsed.query === 'string' ? parsed.query : '',
        type: SESSION_TYPE_OPTIONS.some((item) => item.value === parsed.type) ? parsed.type! : 'all',
        date: SESSION_DATE_OPTIONS.some((item) => item.value === parsed.date) ? parsed.date! : 'all',
      };
    }
  } catch {
    // 损坏或不可用的 sessionStorage 回退到默认筛选。
  }
  return { query: '', type: 'all', date: 'all' };
}

function saveFilter(filter: SessionHistoryFilter): void {
  try {
    sessionStorage.setItem(FILTER_KEY, JSON.stringify(filter));
  } catch {
    // sessionStorage 不可用时不影响会话历史使用。
  }
}

export function useSessionHistory(options: UseSessionHistoryOptions = {}): SessionHistoryController {
  const notify = options.notify ?? noopNotify;
  const [sessions, setSessions] = useState<BackendSessionEntry[]>([]);
  const [groups, setGroups] = useState<BackendGroupEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilterState] = useState<SessionHistoryFilter>(loadFilter);
  const loadRequestRef = useRef(0);
  const activeGroups = useSessionStore((state) => state.groups);

  const setFilter = useCallback((patch: Partial<SessionHistoryFilter>) => {
    setFilterState((previous) => {
      const next = { ...previous, ...patch };
      saveFilter(next);
      return next;
    });
  }, []);

  const load = useCallback(() => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    return Promise.all([listSessions(), groupsList()])
      .then(([nextSessions, nextGroups]) => {
        if (requestId !== loadRequestRef.current) return;
        // IPC/mock 返回值不应与外部可变集合共享引用，否则删除后原数组原地变化会让 React 跳过更新。
        setSessions([...nextSessions]);
        setGroups([...nextGroups]);
      })
      .catch(() => {
        if (requestId !== loadRequestRef.current) return;
        setSessions([]);
        setGroups([]);
      })
      .finally(() => {
        if (requestId === loadRequestRef.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    void load();
  }, [load, activeGroups]);

  const openSession = useCallback((session: BackendSessionEntry) => {
    const workspace = useSessionStore.getState();
    if (session.status !== 'historical' && workspace.tabs.some((tab) => tab.id === session.id)) {
      workspace.activate(session.id);
      return;
    }
    void sessionManager.restore(session.id, session.title).catch((error: unknown) => {
      console.warn('恢复会话失败:', error);
    });
  }, []);

  const deleteHistoricalSession = useCallback((session: BackendSessionEntry) => {
    void sessionManager.remove(session.id)
      .then(load)
      .catch((error: unknown) => console.warn('删除历史会话失败:', error));
  }, [load]);

  const restoreGroup = useCallback(async (group: BackendGroupEntry) => {
    try {
      await groupRestore(group.id);
      const allSessions = await listSessions();
      const groupSessions = allSessions
        .filter((session) => session.group_id === group.id)
        .sort((left, right) => left.sort_order - right.sort_order);
      const workspace = useSessionStore.getState();
      if (!workspace.groups.some((item) => item.id === group.id)) {
        useSessionStore.setState((state) => ({
          groups: [...state.groups, { id: group.id, title: group.title, collapsed: group.collapsed }],
        }));
      }
      for (const session of groupSessions) {
        await sessionManager.restore(session.id, session.title, { groupId: group.id });
      }
      await useSessionStore.getState().loadGroups();
      notify(`已恢复分组：${group.title}`, 'success');
    } catch (error) {
      notify(String((error as Error)?.message ?? error), 'error');
    }
    load();
  }, [load, notify]);

  const deleteGroup = useCallback(async (group: BackendGroupEntry) => {
    if (!window.confirm(`删除分组“${group.title}”及其全部会话历史？此操作不可恢复。`)) return;
    try {
      await groupDeleteWithSessions(group.id);
      notify(`已删除分组：${group.title}`, 'success');
    } catch (error) {
      notify(String((error as Error)?.message ?? error), 'error');
    }
    load();
  }, [load, notify]);

  const sections = useMemo(() => deriveSessionHistorySections(sessions, filter), [sessions, filter]);

  return {
    sessions,
    groups,
    loading,
    filter,
    setFilter,
    load,
    openSession,
    deleteHistoricalSession,
    restoreGroup,
    deleteGroup,
    historical: sections.historical,
    grouped: sections.grouped,
    ungrouped: sections.ungrouped,
    hasFilter: hasSessionHistoryFilter(filter),
  };
}

export { filterSessions, isSshSession, sshTargetOf, type SessionDateFilter, type SessionTypeFilter } from '@features/session-history/model/filter';
export { SESSION_DATE_OPTIONS, SESSION_TYPE_OPTIONS } from '@features/session-history/model/sessionHistoryModel';
export type { SessionHistoryFilter } from '@features/session-history/model/sessionHistoryModel';
