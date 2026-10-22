import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAiWorkspace, useChatStore } from '@features/chat';
import { selectWorkspaceArea } from '@features/workspace/services/selectWorkspaceArea';
import { useHistoryMetaStore } from '@utils/historyMeta';
import { safeJsonParse } from '@utils/errorHandler';
import { useToastStore } from '@ui/Toast';
import { SESSION_DATE_OPTIONS } from '../model/sessionHistoryModel';
import { DEFAULT_UNIFIED_FILTER, HISTORY_TYPES, filterUnifiedHistory, unifiedHistoryRecords, type UnifiedHistoryFilter, type UnifiedHistoryRecord } from '../model/unifiedHistory';
import { useSessionHistory } from './useSessionHistory';

const FILTER_KEY = 'unified-history-filter-v1';
function readFilter(): UnifiedHistoryFilter {
  let raw: string | null = null;
  try { raw = sessionStorage.getItem(FILTER_KEY); } catch { /* Preferences are optional. */ }
  const saved = safeJsonParse<Partial<UnifiedHistoryFilter>>(raw ?? '{}');
  return { query: typeof saved?.query === 'string' ? saved.query : '',
    type: saved?.type && HISTORY_TYPES.includes(saved.type) ? saved.type : 'all',
    date: saved?.date && SESSION_DATE_OPTIONS.some(option => option.value === saved.date) ? saved.date : 'all',
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
  const [filter, setFilter] = useState<UnifiedHistoryFilter>(readFilter);
  useEffect(() => { void useChatStore.getState().loadConversations(); }, []);
  useEffect(() => { try { sessionStorage.setItem(FILTER_KEY, JSON.stringify(filter)); } catch { /* Preferences are optional. */ } }, [filter]);
  const records = useMemo(() => unifiedHistoryRecords(terminal.sessions, conversations, { notes, starred }), [terminal.sessions, conversations, notes, starred]);
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
  return { visible, filter, setFilter: (patch: Partial<UnifiedHistoryFilter>) => setFilter(previous => ({ ...previous, ...patch })),
    resetFilter: () => setFilter(DEFAULT_UNIFIED_FILTER), open, terminalError: terminal.loadError, conversationError,
    loading: terminal.loading || conversationsLoading, refresh };
}
