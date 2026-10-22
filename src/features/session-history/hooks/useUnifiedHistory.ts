import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAiWorkspace, useChatStore } from '@features/chat';
import { selectWorkspaceArea } from '@features/workspace/services/selectWorkspaceArea';
import { useWorkspaceNavigation } from '@features/workspace';
import { historyGroupKey, useHistoryMetaStore } from '@utils/historyMeta';
import { safeJsonParse } from '@utils/errorHandler';
import { useToastStore } from '@ui/Toast';
import { SESSION_DATE_OPTIONS } from '../model/sessionHistoryModel';
import {
  DEFAULT_UNIFIED_FILTER, HISTORY_TYPES, UNIFIED_GROUP_BY_OPTIONS, UNIFIED_SORT_OPTIONS,
  filterUnifiedHistory, unifiedHistoryGroupIdentity, unifiedHistoryRecords, type UnifiedHistoryFilter, type UnifiedHistoryRecord,
} from '../model/unifiedHistory';
import { useSessionHistory } from './useSessionHistory';

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
export function useUnifiedHistory() {
  const notify = useCallback((message: string, kind: 'success' | 'error') => { useToastStore.getState().addToast(message, kind); }, []);
  const terminal = useSessionHistory({ notify });
  const conversations = useChatStore(state => state.conversations);
  const conversationsLoading = useChatStore(state => state.conversationsLoading);
  const conversationError = useChatStore(state => state.conversationError);
  const notes = useHistoryMetaStore(state => state.notes);
  const starred = useHistoryMetaStore(state => state.starred);
  const groupTitles = useHistoryMetaStore(state => state.groupTitles);
  const groupNotes = useHistoryMetaStore(state => state.groupNotes);
  const [filter, setFilter] = useState<UnifiedHistoryFilter>(readFilter);
  const loading = terminal.loading || conversationsLoading;
  useEffect(() => {
    useWorkspaceNavigation.getState().setHistoryLoading(loading);
    return () => useWorkspaceNavigation.getState().setHistoryLoading(false);
  }, [loading]);
  useEffect(() => { void useChatStore.getState().loadConversations(); }, []);
  useEffect(() => { try { sessionStorage.setItem(FILTER_KEY, JSON.stringify(filter)); } catch { /* Preferences are optional. */ } }, [filter]);
  const records = useMemo(() => {
    const titles = new Map(terminal.originalGroups.map(group => [group.id, group.title]));
    return unifiedHistoryRecords(terminal.sessions, conversations, { notes, starred }).map(record => {
      const identity = unifiedHistoryGroupIdentity(record, filter.groupBy);
      const groupKey = historyGroupKey('session', `unified-${filter.groupBy}`, identity.id);
      const originalTitle = record.kind === 'terminal' && record.session.group_id ? titles.get(record.session.group_id) : undefined;
      return { ...record, searchText: [record.searchText, identity.title, groupTitles[groupKey], groupNotes[groupKey], originalTitle]
        .filter(Boolean).join(' ').toLocaleLowerCase() };
    });
  }, [terminal.originalGroups, terminal.sessions, conversations, filter.groupBy, groupNotes, groupTitles, notes, starred]);
  const visible = useMemo(() => filterUnifiedHistory(records, filter), [records, filter]);
  const open = (record: UnifiedHistoryRecord) => {
    if (record.kind === 'terminal') { terminal.openSession(record.session); return; }
    if (!useChatStore.getState().conversations.some(item => item.id === record.conversation.id)) return;
    useAiWorkspace.getState().openNative(record.conversation.id);
    void useChatStore.getState().selectConversation(record.conversation.id);
    selectWorkspaceArea('ai');
  };
  const refresh = async () => {
    useChatStore.setState({ conversationsLoaded: false });
    await Promise.all([terminal.load(), useChatStore.getState().loadConversations()]);
  };
  const restore = (record: UnifiedHistoryRecord) => {
    if (record.kind === 'terminal') terminal.openSession(record.session);
    else void useChatStore.getState().selectConversation(record.conversation.id);
  };
  const remove = async (record: UnifiedHistoryRecord) => {
    if (record.kind === 'terminal') terminal.deleteHistoricalSession(record.session);
    else await useChatStore.getState().deleteConversation(record.conversation.id);
  };
  return { records, visible, filter, setFilter: (patch: Partial<UnifiedHistoryFilter>) => setFilter(previous => ({ ...previous, ...patch })),
    resetFilter: () => setFilter(DEFAULT_UNIFIED_FILTER), open, restore, remove, terminalError: terminal.loadError, conversationError,
    loading, busy: terminal.batchBusy, refresh,
    originalGroups: terminal.originalGroups, renameOriginalGroup: terminal.renameOriginalGroup };
}
