import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChatStore } from '@features/chat';
import { useWorkspaceNavigation, type HistoryTypePreset } from '@features/workspace';
import { useHarnessSessionRefs } from '@features/chat/stores/harnessSessions';
import { historyGroupKey, useHistoryMetaStore } from '@utils/historyMeta';
import { safeJsonParse } from '@utils/errorHandler';
import { useToastStore } from '@ui/feedback/Toast';
import { SESSION_DATE_OPTIONS } from '../model/sessionHistoryModel';
import {
  DEFAULT_UNIFIED_FILTER, HISTORY_TYPES, UNIFIED_GROUP_BY_OPTIONS, UNIFIED_SORT_OPTIONS,
  filterUnifiedHistory, unifiedHistoryGroupIdentity, unifiedHistoryRecords, type UnifiedHistoryFilter, type UnifiedHistoryRecord,
} from '../model/unifiedHistory';
import { useSessionHistory } from './useSessionHistory';
import { useHistoryPages } from './useHistoryPages';
import { parseEnvironment } from '@features/chat/model/conversation';
import { readHistoryPage, type HistoryCursor } from '@platform/api/historyPage';
import type { BackendSessionEntry } from '@platform/api/types';
import type { Conversation } from '@features/chat/model/conversation';
import { restoreHistoryRecord, restoreHistoryMember } from '../services/restoreHistory';
import type { WorkspaceHistoryMember } from '@features/workspace/model/workspaceHistory';
import { deleteSession } from '@platform/api/session';
import { t } from '@i18n';

const FILTER_KEY = 'unified-history-filter-v1';
function readFilter(): UnifiedHistoryFilter {
  let raw: string | null = null;
  try { raw = sessionStorage.getItem(FILTER_KEY); } catch { /* Preferences are optional. */ }
  const saved = safeJsonParse<Partial<UnifiedHistoryFilter>>(raw ?? '{}');
  return { query: typeof saved?.query === 'string' ? saved.query : '',
    type: saved?.type && HISTORY_TYPES.includes(saved.type) ? saved.type : 'all',
    connection: saved?.connection === 'local' || saved?.connection === 'ssh' || saved?.connection === 'discussion' ? saved.connection : 'all',
    date: saved?.date && SESSION_DATE_OPTIONS.some(option => option.value === saved.date) ? saved.date : 'all',
    mode: saved?.mode === 'block' || saved?.mode === 'classic' ? saved.mode : 'all',
    sort: saved?.sort && UNIFIED_SORT_OPTIONS.some(option => option.value === saved.sort) ? saved.sort : 'activity-desc',
    groupBy: saved?.groupBy && UNIFIED_GROUP_BY_OPTIONS.some(option => option.value === saved.groupBy) ? saved.groupBy : 'day',
    dateField: saved?.dateField === 'created' ? 'created' : 'activity',
    starredOnly: saved?.starredOnly === true, layout: saved?.layout === 'split' || saved?.layout === 'single' ? saved.layout : 'all' };
}

/** The unified page queries raw sources and reuses their existing restoration paths. */
export function useUnifiedHistory(preset?: HistoryTypePreset, destinationOverride?: 'native' | 'unified') {
  const notify = useCallback((message: string, kind: 'success' | 'error') => { useToastStore.getState().addToast(message, kind); }, []);
  const [filter, setFilter] = useState<UnifiedHistoryFilter>(() => ({ ...readFilter(), ...(preset ? { type: preset } : {}) }));
  const [query, setQuery] = useState(filter.query);
  useEffect(() => {
    if (!filter.query) { setQuery(''); return; }
    const timer = setTimeout(() => setQuery(filter.query), 300);
    return () => clearTimeout(timer);
  }, [filter.query]);
  const pages = useHistoryPages(filter.type, filter.sort, JSON.stringify({ ...filter, query }), filter.layout);
  const terminalSource = useMemo(() => ({ ...pages, sessions: pages.sessions.filter(session => session.kind !== 'workspace') }), [pages.sessions, pages.groups, pages.loading, pages.error, pages.refresh]);
  const terminal = useSessionHistory({ notify, source: terminalSource });
  const opening = useRef(new Set<string>());
  const conversations = useMemo(() => pages.conversations.map(record => ({ id: record.id, title: record.title, createdAt: record.created_at, updatedAt: record.updated_at, environment: parseEnvironment(record.environment) })), [pages.conversations]);
  const conversationError = pages.error;
  const notes = useHistoryMetaStore(state => state.notes);
  const starred = useHistoryMetaStore(state => state.starred);
  const agentRefs = useHarnessSessionRefs(state => state.refs);
  const groupTitles = useHistoryMetaStore(state => state.groupTitles);
  const groupNotes = useHistoryMetaStore(state => state.groupNotes);
  const loading = pages.loading;
  useEffect(() => {
    useWorkspaceNavigation.getState().setHistoryLoading(loading);
    return () => useWorkspaceNavigation.getState().setHistoryLoading(false);
  }, [loading]);
  useEffect(() => { try { sessionStorage.setItem(FILTER_KEY, JSON.stringify(filter)); } catch { /* Preferences are optional. */ } }, [filter]);
  const enrich = useCallback((sessions: BackendSessionEntry[], chats: Conversation[]) => {
    const titles = new Map(terminal.originalGroups.map(group => [group.id, group.title]));
    const agents = Object.entries(agentRefs).flatMap(([harness, ref]) => ref && typeof ref.sessionId === 'string' && typeof ref.cwd === 'string' && Number.isFinite(ref.at) ? [{ ...ref, harness }] : []);
    return unifiedHistoryRecords(sessions, chats, { notes, starred }, agents).map(record => {
      const identity = unifiedHistoryGroupIdentity(record, filter.groupBy);
      const groupKey = historyGroupKey('session', `unified-${filter.groupBy}`, identity.id);
      const originalTitle = record.kind === 'terminal' && record.session.group_id ? titles.get(record.session.group_id) : undefined;
      return { ...record, searchText: [record.searchText, identity.title, groupTitles[groupKey], groupNotes[groupKey], originalTitle]
        .filter(Boolean).join(' ').toLocaleLowerCase() };
    });
  }, [terminal.originalGroups, filter.groupBy, groupNotes, groupTitles, notes, starred, agentRefs]);
  const records = useMemo(() => enrich(pages.sessions, conversations), [enrich, pages.sessions, conversations]);
  const visible = useMemo(() => filterUnifiedHistory(records, filter), [records, filter]);
  useEffect(() => {
    if (query !== filter.query || !filter.query && filter.connection === 'all' && filter.mode === 'all' && filter.date === 'all' && !filter.starredOnly) return;
    if (visible.length >= 40 || !pages.hasMore || pages.loading || pages.loadingMore || pages.error) return;
    const frame = requestAnimationFrame(() => { void pages.loadMore(); });
    return () => cancelAnimationFrame(frame);
  }, [filter, query, visible.length, records.length, pages.hasMore, pages.loading, pages.loadingMore, pages.error, pages.loadMore]);
  const open = async (record: UnifiedHistoryRecord) => {
    if (opening.current.has(record.key)) return;
    opening.current.add(record.key);
    const destination = destinationOverride ?? useWorkspaceNavigation.getState().historyDestination;
    try {
      await restoreHistoryRecord(record, destination);
    } catch (error) { notify(t('Could not restore workspace: {{error}}', { error: String(error) }), 'error'); }
    finally { opening.current.delete(record.key); }
  };
  const collect = async (matching = true) => {
    if (!pages.hasMore) return matching ? visible : records;
    const sessions: BackendSessionEntry[] = [];
    const chats: Conversation[] = [];
    let cursor: HistoryCursor | null = null;
    do {
      const page = await readHistoryPage({ source: filter.type, sort: filter.sort, layout: filter.layout, limit: 100, cursor });
      sessions.push(...page.sessions);
      chats.push(...page.conversations.map(record => ({ id: record.id, title: record.title, createdAt: record.created_at, updatedAt: record.updated_at, environment: parseEnvironment(record.environment) })));
      cursor = page.nextCursor;
      if (cursor) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    } while (cursor);
    const all = enrich(sessions, chats);
    return matching ? filterUnifiedHistory(all, filter) : all;
  };
  const refresh = async () => {
    await pages.refresh();
  };
  return { records, visible, filter, setFilter: (patch: Partial<UnifiedHistoryFilter>) => setFilter(previous => ({ ...previous, ...patch })),
    openMember: async (member: WorkspaceHistoryMember) => {
      const destination = destinationOverride ?? useWorkspaceNavigation.getState().historyDestination;
      try { await restoreHistoryMember(member, destination); }
      catch (error) { notify(t('Could not restore workspace: {{error}}', { error: String(error) }), 'error'); }
    },
    resetFilter: () => setFilter(DEFAULT_UNIFIED_FILTER), open, terminalError: terminal.loadError, conversationError,
    loading, loadingMore: pages.loadingMore, hasMore: pages.hasMore, loadMore: pages.loadMore, busy: terminal.batchBusy, refresh, collect,
    openMany: async (targets: readonly UnifiedHistoryRecord[]) => {
      for (const record of targets) await open(record);
    },
    removeMany: async (targets: readonly UnifiedHistoryRecord[]) => {
      const sessions = targets.flatMap(record => record.kind === 'terminal' ? [record.session] : []);
      if (sessions.length) await terminal.deleteSessions(sessions);
      for (const record of targets) if (record.kind === 'workspace') await deleteSession(record.session.id);
      for (const record of targets) if (record.kind === 'conversation') await useChatStore.getState().deleteConversation(record.conversation.id);
      for (const record of targets) if (record.kind === 'agent') {
        useHarnessSessionRefs.getState().forget(record.agent.harness, record.agent.sessionId);
        useHistoryMetaStore.getState().removeRecords([record.key]);
      }
      await pages.refresh();
    },
    originalGroups: terminal.originalGroups, renameOriginalGroup: terminal.renameOriginalGroup };
}
