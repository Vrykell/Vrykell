import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listSessions } from '@platform/api/session';
import { groupsList, groupRename } from '@platform/api/group';
import type { BackendGroupEntry, BackendSessionEntry } from '@platform/api/types';
import { useSessionStore } from '@features/workspace';
import * as sessionManager from '@features/workspace/services/sessionManager';
import { historyRecordKey, historySearchAnnotations, scopedIds, useHistoryMetaStore } from '@utils/historyMeta';
import { runHistoryBatch } from '@utils/historyBatch';
import { t } from '@i18n';
import {
  deriveSessionHistorySections,
  groupHistoricalSessions,
  hasSessionHistoryFilter,
  SESSION_DATE_OPTIONS,
  SESSION_TYPE_OPTIONS,
  SESSION_MODE_OPTIONS,
  SESSION_SORT_OPTIONS,
  SESSION_GROUP_BY_OPTIONS,
  sessionHistoryDateField,
  updateSessionHistoryFilter,
  type SessionHistoryFilter,
} from '@features/session-history/model/sessionHistoryModel';

export type SessionHistoryNotification = (message: string, kind: 'success' | 'error') => void;

export interface UseSessionHistoryOptions {
  notify?: SessionHistoryNotification;
  source?: { sessions: BackendSessionEntry[]; groups: BackendGroupEntry[]; loading: boolean; error: string; refresh: () => Promise<void> };
}

export interface SessionHistoryController {
  sessions: BackendSessionEntry[];
  originalGroups: BackendGroupEntry[];
  renameOriginalGroup: (id: string, title: string) => Promise<void>;
  loading: boolean;
  /** Load failure message; the view renders it through the shared ErrorBox. */
  loadError: string;
  filter: SessionHistoryFilter;
  setFilter: (patch: Partial<SessionHistoryFilter>) => void;
  /** Starred session ids, used by the view for row markers and the starred-only filter. */
  starredIds: ReadonlySet<string>;
  load: () => Promise<void>;
  openSession: (session: BackendSessionEntry) => void;
  deleteHistoricalSession: (session: BackendSessionEntry) => void;
  restoreSessions: (sessions: readonly BackendSessionEntry[]) => Promise<void>;
  deleteSessions: (sessions: readonly BackendSessionEntry[]) => Promise<void>;
  batchBusy: boolean;
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
      const sort = SESSION_SORT_OPTIONS.some(item => item.value === parsed.sort) ? parsed.sort! : 'closed-desc';
      return {
        query: typeof parsed.query === 'string' ? parsed.query : '',
        type: SESSION_TYPE_OPTIONS.some((item) => item.value === parsed.type) ? parsed.type! : 'all',
        date: SESSION_DATE_OPTIONS.some((item) => item.value === parsed.date) ? parsed.date! : 'all',
        mode: SESSION_MODE_OPTIONS.some(item => item.value === parsed.mode) ? parsed.mode! : 'all',
        sort,
        groupBy: SESSION_GROUP_BY_OPTIONS.some(item => item.value === parsed.groupBy) ? parsed.groupBy! : 'day',
        dateField: parsed.dateField === 'created' || parsed.dateField === 'closed' ? parsed.dateField : sessionHistoryDateField(sort),
        starredOnly: parsed.starredOnly === true,
      };
    }
  } catch {
    // 损坏或不可用的 sessionStorage 回退到默认筛选。
  }
  return { query: '', type: 'all', date: 'all', mode: 'all', sort: 'closed-desc', groupBy: 'day', dateField: 'closed', starredOnly: false };
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
  const [ownSessions, setSessions] = useState<BackendSessionEntry[]>([]);
  const [ownGroups, setOriginalGroups] = useState<BackendGroupEntry[]>([]);
  const [ownLoading, setLoading] = useState(true);
  const [ownLoadError, setLoadError] = useState('');
  const sessions = options.source?.sessions ?? ownSessions;
  const originalGroups = options.source?.groups ?? ownGroups;
  const loading = options.source?.loading ?? ownLoading;
  const loadError = options.source?.error ?? ownLoadError;
  const [batchBusy, setBatchBusy] = useState(false);
  const batchBusyRef = useRef(false);
  const [filter, setFilterState] = useState<SessionHistoryFilter>(loadFilter);
  const loadRequestRef = useRef(0);
  const activeGroups = useSessionStore((state) => state.groups);
  const meta = useHistoryMetaStore();
  const starredIds = useMemo(() => scopedIds(meta.starred, 'session'), [meta.starred]);
  const annotations = useMemo(() => {
    const cards = groupHistoricalSessions(sessions.filter(session => session.status === 'historical'), filter.groupBy ?? 'day', filter.sort, filter.dateField,
      null, { groups: originalGroups, sessions });
    const describe = (original: boolean) => cards.filter(card => Boolean(card.originalGroup) === original)
      .map(card => ({ ...card, recordIds: card.sessions.map(session => session.id) }));
    return new Map([...historySearchAnnotations('session', filter.groupBy ?? 'day', describe(false), meta),
      ...historySearchAnnotations('session', 'original', describe(true), meta)]);
  }, [sessions, originalGroups, filter.groupBy, filter.sort, filter.dateField, meta.notes, meta.groupTitles, meta.groupNotes]);

  const setFilter = useCallback((patch: Partial<SessionHistoryFilter>) => {
    setFilterState((previous) => {
      const next = updateSessionHistoryFilter(previous, patch);
      saveFilter(next);
      return next;
    });
  }, []);

  const load = useCallback(() => {
    if (options.source) return options.source.refresh();
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setLoadError('');
    return Promise.all([listSessions(), groupsList()])
      .then(([nextSessions, nextGroups]) => {
        if (requestId !== loadRequestRef.current) return;
        // Clone IPC results so external mutable collections cannot suppress a render.
        setSessions([...nextSessions]);
        setOriginalGroups([...nextGroups]);
      })
      .catch((error: unknown) => {
        if (requestId !== loadRequestRef.current) return;
        setSessions([]);
        setOriginalGroups([]);
        setLoadError(String((error as Error)?.message ?? error));
      })
      .finally(() => {
        if (requestId === loadRequestRef.current) setLoading(false);
      });
  }, [options.source?.refresh]);

  useEffect(() => {
    if (!options.source) void load();
  }, [load, activeGroups, !!options.source]);

  const openSession = useCallback((session: BackendSessionEntry) => {
    if (batchBusyRef.current) return;
    const workspace = useSessionStore.getState();
    if (session.status !== 'historical' && workspace.tabs.some((tab) => tab.id === session.id)) {
      workspace.activate(session.id);
      return;
    }
    void sessionManager.restore(session.id, session.title).then(load).catch((error: unknown) => {
      console.warn('Session restoration failed:', error);
      notify(t('Could not restore session: {{error}}', { error: String(error) }), 'error');
    });
  }, [notify, load]);

  const renameOriginalGroup = useCallback(async (id: string, title: string) => {
    const name = title.trim();
    if (!name) return;
    try {
      await groupRename(id, name);
      useSessionStore.setState(state => ({ groups: state.groups.map(group => group.id === id ? { ...group, title: name } : group) }));
      await load();
    } catch (error) {
      notify(t('Could not rename group: {{error}}', { error: String(error) }), 'error');
    }
  }, [load, notify]);

  const deleteHistoricalSession = useCallback((session: BackendSessionEntry) => {
    if (batchBusyRef.current || useHistoryMetaStore.getState().lockedRecords[historyRecordKey('session', session.id)]) return;
    void sessionManager.remove(session.id)
      .then(() => { useHistoryMetaStore.getState().removeRecords([historyRecordKey('session', session.id)]); return load(); })
      .catch((error: unknown) => {
        console.warn('删除历史会话失败:', error);
        notify(`删除历史会话失败：${String((error as Error)?.message ?? error)}`, 'error');
      });
  }, [load, notify]);

  const processSessions = useCallback(async (targets: readonly BackendSessionEntry[], action: 'restore' | 'delete') => {
    if (batchBusyRef.current) return;
    batchBusyRef.current = true;
    setBatchBusy(true);
    try {
      const eligible = targets.filter(session => session.status === 'historical'
        && (action !== 'delete' || !useHistoryMetaStore.getState().lockedRecords[historyRecordKey('session', session.id)]));
      // Keep each restored original group in its saved tab order, independently of display sorting.
      const ordered = action === 'restore' ? eligible.flatMap((session, index) => {
        if (!session.group_id) return [session];
        if (eligible.findIndex(item => item.group_id === session.group_id) !== index) return [];
        return eligible.filter(item => item.group_id === session.group_id).sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
      }) : eligible;
      const result = await runHistoryBatch(ordered, async session => {
        if (action === 'restore') await sessionManager.restore(session.id, session.title);
        else {
          if (useHistoryMetaStore.getState().lockedRecords[historyRecordKey('session', session.id)]) throw new Error('Record is locked');
          await sessionManager.remove(session.id);
          useHistoryMetaStore.getState().removeRecords([historyRecordKey('session', session.id)]);
        }
      });
      await load();
      notify(result.failed.length
        ? t('{{succeeded}} completed; {{failed}} failed', { succeeded: result.succeeded.length, failed: result.failed.length })
        : t(action === 'restore' ? '{{count}} sessions restored' : '{{count}} sessions deleted', { count: result.succeeded.length }),
      result.failed.length ? 'error' : 'success');
    } finally {
      batchBusyRef.current = false;
      setBatchBusy(false);
    }
  }, [load, notify]);

  const sections = useMemo(
    () => deriveSessionHistorySections(sessions, filter, filter.starredOnly ? starredIds : null, annotations),
    [sessions, filter, starredIds, annotations],
  );

  return {
    sessions,
    originalGroups,
    renameOriginalGroup,
    loading,
    loadError,
    filter,
    setFilter,
    starredIds,
    load,
    openSession,
    deleteHistoricalSession,
    restoreSessions: targets => processSessions(targets, 'restore'),
    deleteSessions: targets => processSessions(targets, 'delete'),
    batchBusy,
    historical: sections.historical,
    grouped: sections.grouped,
    ungrouped: sections.ungrouped,
    hasFilter: hasSessionHistoryFilter(filter),
  };
}

export { filterSessions, isSshSession, sshTargetOf, type SessionDateFilter, type SessionTypeFilter } from '@features/session-history/model/filter';
export { SESSION_DATE_OPTIONS, SESSION_TYPE_OPTIONS } from '@features/session-history/model/sessionHistoryModel';
export type { SessionHistoryFilter } from '@features/session-history/model/sessionHistoryModel';
