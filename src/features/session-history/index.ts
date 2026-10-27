/** Public entry point of the session history feature; pages do not need to know the internal model layout. */
export {
  useSessionHistory,
  type SessionHistoryController,
  type SessionHistoryNotification,
  type UseSessionHistoryOptions,
} from '@features/session-history/hooks/useSessionHistory';

export {
  filterSessions,
  isSshSession,
  sshTargetOf,
  type SessionDateFilter,
  type SessionTypeFilter,
  type SessionModeFilter,
} from '@features/session-history/model/filter';

export {
  sessionCommandCount,
  SESSION_DATE_OPTIONS,
  SESSION_TYPE_OPTIONS,
  SESSION_MODE_OPTIONS,
  SESSION_SORT_OPTIONS,
  SESSION_GROUP_BY_OPTIONS,
  groupHistoricalSessions,
  type SessionHistoryGroupBy,
  type SessionHistorySort,
  type SessionHistoryFilter,
} from '@features/session-history/model/sessionHistoryModel';

export { default as SessionHistoryView } from '@features/session-history/components/SessionHistoryView';
export { default as UnifiedHistoryView } from '@features/session-history/components/UnifiedHistoryView';
