import type { BackendSessionEntry } from '@platform/api/types';
import type { Conversation } from '@features/chat/model/conversation';
import { historyRecordKey, type HistoryMetaState } from '@utils/historyMeta';
import { sessionHistoryTerminals } from './sessionMetadata';
import { sshTargetOf, type SessionDateFilter } from './filter';

export const HISTORY_TYPES = ['all', 'terminal', 'local', 'ssh', 'conversation'] as const;
export type UnifiedHistoryType = typeof HISTORY_TYPES[number];
export interface UnifiedHistoryFilter { query: string; type: UnifiedHistoryType; date: SessionDateFilter; starredOnly: boolean }
export const DEFAULT_UNIFIED_FILTER: UnifiedHistoryFilter = { query: '', type: 'all', date: 'all', starredOnly: false };

interface HistoryRecordBase {
  key: string;
  title: string;
  timestamp: number;
  description: string;
  searchText: string;
  local: boolean;
  ssh: boolean;
  note: string;
  starred: boolean;
}
export type UnifiedHistoryRecord = HistoryRecordBase & (
  { kind: 'terminal'; session: BackendSessionEntry } | { kind: 'conversation'; conversation: Conversation }
);

const timestamp = (value: number, fallback: number) => Number.isFinite(value) ? value : Number.isFinite(fallback) ? fallback : 0;

/** Read both sources without applying either original page's saved filters or changing ownership. */
export function unifiedHistoryRecords(sessions: readonly BackendSessionEntry[], conversations: readonly Conversation[],
  meta: Pick<HistoryMetaState, 'notes' | 'starred'>): UnifiedHistoryRecord[] {
  const terminals: UnifiedHistoryRecord[] = sessions.filter(session => session.status === 'historical').map(session => {
    const panes = sessionHistoryTerminals(session);
    const description = [...new Set([sshTargetOf(session), ...panes.map(pane => pane.cwd)].filter(Boolean))].join(' · ');
    const key = historyRecordKey('session', session.id);
    const note = meta.notes[key] ?? '';
    return { kind: 'terminal', session, key, title: session.title, timestamp: timestamp(session.closed_at ?? session.created_at, session.created_at),
      description, local: panes.some(pane => pane.kind === 'local'), ssh: panes.some(pane => pane.kind === 'ssh'),
      note, starred: !!meta.starred[key], searchText: [session.title, description, note].join(' ').toLocaleLowerCase() };
  });
  const chats: UnifiedHistoryRecord[] = conversations.map(conversation => {
    const environment = conversation.environment;
    const description = [environment?.label, environment?.ssh?.host, environment?.cwd].filter(Boolean).join(' · ');
    const key = historyRecordKey('conversation', conversation.id);
    const note = meta.notes[key] ?? '';
    return { kind: 'conversation', conversation, key, title: conversation.title, timestamp: timestamp(conversation.updatedAt, conversation.createdAt),
      description, local: false, ssh: false, note, starred: !!meta.starred[key],
      searchText: [conversation.title, description, note].join(' ').toLocaleLowerCase() };
  });
  return [...terminals, ...chats].sort((a, b) => b.timestamp - a.timestamp || a.key.localeCompare(b.key));
}

export function filterUnifiedHistory(records: readonly UnifiedHistoryRecord[], filter: UnifiedHistoryFilter, now = Date.now()): UnifiedHistoryRecord[] {
  const query = filter.query.trim().toLocaleLowerCase();
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const days = filter.date === '7d' ? 7 : filter.date === '30d' ? 30 : 90;
  const since = filter.date === 'all' ? -Infinity : filter.date === 'today' ? start.getTime() : now - days * 86400000;
  return records.filter(record => (!query || record.searchText.includes(query)) && record.timestamp >= since
    && (!filter.starredOnly || record.starred)
    && (filter.type === 'all' || filter.type === 'terminal' && record.kind === 'terminal'
      || filter.type === 'conversation' && record.kind === 'conversation'
      || filter.type === 'local' && record.local || filter.type === 'ssh' && record.ssh));
}
