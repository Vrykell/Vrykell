/** 会话历史功能公开入口，页面不需要了解内部 model 目录结构。 */
export {
  useSessionHistory,
  type SessionHistoryController,
  type SessionHistoryNotification,
  type UseSessionHistoryOptions,
} from './model/useSessionHistory';

export {
  filterSessions,
  isSshSession,
  sshTargetOf,
  type SessionDateFilter,
  type SessionTypeFilter,
} from './model/filter';

export {
  SESSION_DATE_OPTIONS,
  SESSION_TYPE_OPTIONS,
  type SessionHistoryFilter,
} from './model/sessionHistoryModel';
