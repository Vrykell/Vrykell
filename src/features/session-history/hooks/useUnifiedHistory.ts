import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAiWorkspace, useChatStore } from '@features/chat';
import { selectWorkspaceArea } from '@features/workspace/services/selectWorkspaceArea';
import { useWorkspaceNavigation, type HistoryTypePreset } from '@features/workspace';
import { useWorkspaceStore } from '@features/workspace/stores/workspace';
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
    starredOnly: saved?.starredOnly === true };
}

/** The unified page queries raw sources and reuses their existing restoration paths. */
export function useUnifiedHistory(preset?: HistoryTypePreset) {
  const notify = useCallback((message: string, kind: 'success' | 'error') => { useToastStore.getState().addToast(message, kind); }, []);
  const [filter, setFilter] = useState<UnifiedHistoryFilter>(() => ({ ...readFilter(), ...(preset ? { type: preset } : {}) }));
  const [query, setQuery] = useState(filter.query);
  useEffect(() => {
    if (!filter.query) { setQuery(''); return; }
    const timer = setTimeout(() => setQuery(filter.query), 300);
    return () => clearTimeout(timer);
  }, [filter.query]);
  const pages = useHistoryPages(filter.type, filter.sort, JSON.stringify({ ...filter, query }));
  const terminal = useSessionHistory({ notify, source: pages });
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
  const records = useMemo(() => enrich(terminal.sessions, conversations), [enrich, terminal.sessions, conversations]);
  const visible = useMemo(() => filterUnifiedHistory(records, filter), [records, filter]);
  useEffect(() => {
    if (query !== filter.query || !filter.query && filter.connection === 'all' && filter.mode === 'all' && filter.date === 'all' && !filter.starredOnly) return;
    if (visible.length >= 40 || !pages.hasMore || pages.loading || pages.loadingMore || pages.error) return;
    const frame = requestAnimationFrame(() => { void pages.loadMore(); });
    return () => cancelAnimationFrame(frame);
  }, [filter, query, visible.length, records.length, pages.hasMore, pages.loading, pages.loadingMore, pages.error, pages.loadMore]);
  const open = (record: UnifiedHistoryRecord) => {
    if (record.kind === 'terminal') { terminal.openSession(record.session); return; }
    if (record.kind === 'agent') { useWorkspaceStore.getState().openHarnessTab(record.agent.harness, record.agent.cwd); return; }
    if (!useChatStore.getState().conversations.some(item => item.id === record.conversation.id)) useChatStore.setState(state => ({ conversations: [...state.conversations, record.conversation] }));
    useAiWorkspace.getState().openNative(record.conversation.id);
    void useChatStore.getState().selectConversation(record.conversation.id);
    selectWorkspaceArea('ai');
  };
  const collect = async (matching = true) => {
    if (!pages.hasMore) return matching ? visible : records;
    const sessions: BackendSessionEntry[] = [];
    const chats: Conversation[] = [];
    let cursor: HistoryCursor | null = null;
    do {
      const page = await readHistoryPage({ source: filter.type, sort: filter.sort, limit: 100, cursor });
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
    resetFilter: () => setFilter(DEFAULT_UNIFIED_FILTER), open, terminalError: terminal.loadError, conversationError,
    loading, loadingMore: pages.loadingMore, hasMore: pages.hasMore, loadMore: pages.loadMore, busy: terminal.batchBusy, refresh, collect,
    openMany: async (targets: readonly UnifiedHistoryRecord[]) => {
      const sessions = targets.flatMap(record => record.kind === 'terminal' ? [record.session] : []);
      if (sessions.length) await terminal.restoreSessions(sessions);
      for (const record of targets) if (record.kind !== 'terminal') open(record);
    },
    removeMany: async (targets: readonly UnifiedHistoryRecord[]) => {
      const sessions = targets.flatMap(record => record.kind === 'terminal' ? [record.session] : []);
      if (sessions.length) await terminal.deleteSessions(sessions);
      for (const record of targets) if (record.kind === 'conversation') await useChatStore.getState().deleteConversation(record.conversation.id);
      for (const record of targets) if (record.kind === 'agent') {
        useHarnessSessionRefs.getState().forget(record.agent.harness, record.agent.sessionId);
        useHistoryMetaStore.getState().removeRecords([record.key]);
      }
      await pages.refresh();
    },
    originalGroups: terminal.originalGroups, renameOriginalGroup: terminal.renameOriginalGroup };
}
