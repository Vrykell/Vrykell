import { invoke } from '@platform/diagnostics';
import type { BackendSessionEntry } from './types';
import type { BackendConversation } from './conversation';

export interface HistoryCursor { value: string; key: string }
export interface HistoryPage {
  sessions: BackendSessionEntry[];
  conversations: BackendConversation[];
  nextCursor: HistoryCursor | null;
}
export interface HistoryPageRequest {
  limit: number;
  source: 'all' | 'terminal' | 'conversation';
  sort: 'activity-desc' | 'activity-asc' | 'created-desc' | 'created-asc' | 'title-asc' | 'title-desc';
  cursor: HistoryCursor | null;
}
export const readHistoryPage = (request: HistoryPageRequest) => invoke<HistoryPage>('history_page', { request });
