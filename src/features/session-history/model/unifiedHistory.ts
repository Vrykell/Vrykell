import type { BackendSessionEntry } from '@platform/api/types';
import type { Conversation } from '@features/chat/model/conversation';
import { historyRecordKey, type HistoryMetaState } from '@utils/historyMeta';
import { t } from '@i18n';
import { sessionHistoryTerminals } from './sessionMetadata';
import { sessionTerminalModes, sshTargetOf, type SessionDateFilter, type SessionModeFilter } from './filter';
import { parseWorkspaceHistory, type WorkspaceHistorySnapshot } from '@features/workspace/model/workspaceHistory';

export const HISTORY_TYPES = ['all', 'terminal', 'conversation'] as const;
export type UnifiedHistoryType = typeof HISTORY_TYPES[number];
export type UnifiedConnectionFilter = 'all' | 'local' | 'ssh' | 'discussion';
export type UnifiedHistorySort = 'activity-desc' | 'activity-asc' | 'created-desc' | 'created-asc' | 'title-asc' | 'title-desc';
export type UnifiedHistoryGroupBy = 'day' | 'week' | 'month' | 'cwd' | 'type' | 'terminal' | 'none';
export const UNIFIED_SORT_OPTIONS = [
  { value: 'activity-desc', label: 'Recently active' },
  { value: 'activity-asc', label: 'Earliest active' },
  { value: 'created-desc', label: 'Recently created' },
  { value: 'created-asc', label: 'Earliest created' },
  { value: 'title-asc', label: 'Title A–Z' },
  { value: 'title-desc', label: 'Title Z–A' },
] as const satisfies readonly { value: UnifiedHistorySort; label: string }[];
export const UNIFIED_GROUP_BY_OPTIONS = [
  { value: 'day', label: 'By day' },
  { value: 'week', label: 'By week' },
  { value: 'month', label: 'By month' },
  { value: 'cwd', label: 'Working directory' },
  { value: 'type', label: 'Connection type' },
  { value: 'terminal', label: 'Terminal type' },
  { value: 'none', label: 'No grouping' },
] as const satisfies readonly { value: UnifiedHistoryGroupBy; label: string }[];
export interface UnifiedHistoryFilter {
  query: string;
  type: UnifiedHistoryType;
  connection: UnifiedConnectionFilter;
  date: SessionDateFilter;
  mode: SessionModeFilter;
  sort: UnifiedHistorySort;
  groupBy: UnifiedHistoryGroupBy;
  dateField: 'activity' | 'created';
  starredOnly: boolean;
  layout?: 'all' | 'single' | 'split';
}
export const DEFAULT_UNIFIED_FILTER: UnifiedHistoryFilter = {
  query: '', type: 'all', connection: 'all', date: 'all', mode: 'all', sort: 'activity-desc', groupBy: 'day', dateField: 'activity', starredOnly: false, layout: 'all',
};

interface HistoryRecordBase {
  key: string;
  title: string;
  timestamp: number;
  description: string;
  searchText: string;
  cwd: string;
  connectionTarget: string;
  connection: 'local' | 'ssh' | 'mixed' | 'discussion';
  terminalType: string;
  modes: readonly Exclude<SessionModeFilter, 'all'>[];
  createdAt: number;
  local: boolean;
  ssh: boolean;
  note: string;
  starred: boolean;
  paneCount: number;
  types: readonly ('terminal' | 'conversation')[];
}
export interface UnifiedAgentReference { harness: string; sessionId: string; cwd: string; at: number }
export type UnifiedHistoryRecord = HistoryRecordBase & (
  { kind: 'terminal'; session: BackendSessionEntry } | { kind: 'conversation'; conversation: Conversation } | { kind: 'agent'; agent: UnifiedAgentReference }
  | { kind: 'workspace'; session: BackendSessionEntry; snapshot: WorkspaceHistorySnapshot }
);

const timestamp = (value: number, fallback: number) => Number.isFinite(value) ? value : Number.isFinite(fallback) ? fallback : 0;

/** Read both sources without applying either original page's saved filters or changing ownership. */
export function unifiedHistoryRecords(sessions: readonly BackendSessionEntry[], conversations: readonly Conversation[],
  meta: Pick<HistoryMetaState, 'notes' | 'starred'>, agents: readonly UnifiedAgentReference[] = []): UnifiedHistoryRecord[] {
  const terminals: UnifiedHistoryRecord[] = sessions.filter(session => session.status === 'historical' && session.kind !== 'workspace').map(session => {
    const panes = sessionHistoryTerminals(session);
    const cwd = [...new Set(panes.map(pane => pane.cwd).filter(Boolean))].join(', ');
    const description = [...new Set([sshTargetOf(session), cwd].filter(Boolean))].join(' · ');
    const key = historyRecordKey('session', session.id);
    const note = meta.notes[key] ?? '';
    return { kind: 'terminal', session, key, title: session.title, paneCount: panes.length, types: ['terminal'], timestamp: timestamp(session.closed_at ?? session.created_at, session.created_at),
      description, cwd, connection: panes.some(pane => pane.kind === 'local') && panes.some(pane => pane.kind === 'ssh') ? 'mixed'
        : panes.some(pane => pane.kind === 'ssh') ? 'ssh' : 'local',
      terminalType: panes.some(pane => pane.kind === 'ssh') && !panes.some(pane => pane.kind === 'local') ? 'ssh'
        : [...new Set(panes.map(pane => pane.shellType).filter((value): value is string => Boolean(value)))].join(', ') || 'terminal',
      connectionTarget: sshTargetOf(session) ?? '',
      modes: [...sessionTerminalModes(session)], createdAt: session.created_at,
      local: panes.some(pane => pane.kind === 'local'), ssh: panes.some(pane => pane.kind === 'ssh'),
      note, starred: !!meta.starred[key], searchText: [session.title, description, note, ...sessionTerminalModes(session)].join(' ').toLocaleLowerCase() };
  });
  const chats: UnifiedHistoryRecord[] = conversations.map(conversation => {
    const environment = conversation.environment;
    const description = [environment?.label, environment?.ssh?.host, environment?.cwd].filter(Boolean).join(' · ');
    const key = historyRecordKey('conversation', conversation.id);
    const note = meta.notes[key] ?? '';
    return { kind: 'conversation', conversation, key, title: conversation.title, paneCount: 1, types: ['conversation'], timestamp: timestamp(conversation.updatedAt, conversation.createdAt),
      description, cwd: environment?.cwd ?? '', connectionTarget: environment?.ssh
        ? `${environment.ssh.user ? `${environment.ssh.user}@` : ''}${environment.ssh.host}${environment.ssh.port && environment.ssh.port !== 22 ? `:${environment.ssh.port}` : ''}` : '',
      connection: !environment ? 'discussion' : environment.kind,
      terminalType: 'AI', modes: [], createdAt: conversation.createdAt,
      local: environment?.kind === 'local', ssh: environment?.kind === 'ssh', note, starred: !!meta.starred[key],
      searchText: [conversation.title, description, note, environment?.kind ?? 'discussion'].join(' ').toLocaleLowerCase() };
  });
  const external: UnifiedHistoryRecord[] = agents.map(agent => {
    const key = historyRecordKey('conversation', `acp:${JSON.stringify([agent.harness, agent.sessionId])}`); const note = meta.notes[key] ?? '';
    return { kind: 'agent', agent, key, title: agent.harness, paneCount: 1, types: ['conversation'], timestamp: agent.at, createdAt: agent.at, description: t('ACP session reference'),
      cwd: agent.cwd, connectionTarget: '', connection: 'local', terminalType: 'ACP', modes: [], local: true, ssh: false,
      note, starred: !!meta.starred[key], searchText: [agent.harness, agent.cwd, note, 'ACP'].join(' ').toLocaleLowerCase() };
  });
  const terminalMetadata = new Map(sessions.filter(session => session.kind !== 'workspace').map(session => [session.id, sessionHistoryTerminals(session)]));
  const workspaces: UnifiedHistoryRecord[] = sessions.flatMap(session => {
    if (session.kind !== 'workspace' || session.status !== 'historical') return [];
    const snapshot = parseWorkspaceHistory(session.payload);
    if (!snapshot) return [];
    snapshot.members = snapshot.members.map(member => {
      if (member.kind !== 'terminal' || member.shellType) return member;
      const candidates = terminalMetadata.get(member.reference);
      if (!candidates) return member;
      const terminal = candidates.find(item => item.paneId === member.paneId) ?? candidates[0];
      return terminal ? { ...member, shellType: terminal.shellType, connectionId: member.ssh ? terminal.remoteId : member.connectionId } : member;
    });
    const key = historyRecordKey('session', session.id);
    const note = meta.notes[key] ?? '';
    const local = snapshot.members.some(member => member.local);
    const ssh = snapshot.members.some(member => member.ssh);
    const cwd = [...new Set(snapshot.members.map(member => member.cwd).filter(Boolean))].join(', ');
    const types: ('terminal' | 'conversation')[] = [];
    if (snapshot.members.some(member => member.kind === 'terminal')) types.push('terminal');
    if (snapshot.members.some(member => member.kind === 'conversation' || member.kind === 'agent')) types.push('conversation');
    const description = snapshot.members.map(member => member.title).join(' + ');
    return [{ kind: 'workspace' as const, session, snapshot, key, title: session.title, timestamp: timestamp(session.closed_at ?? session.created_at, session.created_at),
      createdAt: session.created_at, description, cwd, connectionTarget: '', connection: local && ssh ? 'mixed' as const : ssh ? 'ssh' as const : local ? 'local' as const : 'discussion' as const,
      terminalType: 'workspace', modes: [...new Set(snapshot.members.flatMap(member => member.modes ?? []))], local, ssh, note, starred: !!meta.starred[key],
      paneCount: snapshot.members.reduce((count, member) => count + member.paneCount, 0), types,
      searchText: [session.title, description, cwd, note, ...snapshot.members.map(member => member.kind)].join(' ').toLocaleLowerCase() }];
  });
  return [...terminals, ...chats, ...external, ...workspaces].sort((a, b) => b.timestamp - a.timestamp || a.key.localeCompare(b.key));
}

export function filterUnifiedHistory(records: readonly UnifiedHistoryRecord[], filter: UnifiedHistoryFilter, now = Date.now()): UnifiedHistoryRecord[] {
  const query = filter.query.trim().toLocaleLowerCase();
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const days = filter.date === '7d' ? 7 : filter.date === '30d' ? 30 : 90;
  const since = filter.date === 'all' ? -Infinity : filter.date === 'today' ? start.getTime() : now - days * 86400000;
  const visible = records.filter(record => (!query || record.searchText.includes(query))
    && (filter.dateField === 'created' ? record.createdAt : record.timestamp) >= since
    && (!filter.starredOnly || record.starred)
    && (filter.mode === 'all' || record.modes.includes(filter.mode))
    && (filter.connection === 'all' || filter.connection === 'local' && record.local
      || filter.connection === 'ssh' && record.ssh || filter.connection === 'discussion' && record.connection === 'discussion')
    && (filter.type === 'all' || record.types.includes(filter.type))
    && (!filter.layout || filter.layout === 'all' || (filter.layout === 'split' ? record.paneCount > 1 : record.paneCount === 1)));
  return [...visible].sort((left, right) => {
    if (filter.sort === 'title-asc' || filter.sort === 'title-desc') {
      const order = left.title.localeCompare(right.title, undefined, { numeric: true });
      return filter.sort === 'title-asc' ? order : -order;
    }
    const field = filter.sort.startsWith('created') ? 'createdAt' : 'timestamp';
    const order = left[field] - right[field];
    return filter.sort.endsWith('asc') ? order : -order;
  });
}

export interface UnifiedHistoryGroup {
  id: string;
  title: string;
  originalTitle: string;
  subtitle?: string;
  records: UnifiedHistoryRecord[];
  timestamp: number;
}

const CONNECTION_LABELS = {
  local: 'Local terminals', ssh: 'SSH terminals', mixed: 'Mixed connections', discussion: 'Discussion only',
} as const;

function startOfWeek(date: Date) {
  const value = new Date(date); const day = value.getDay(); value.setDate(value.getDate() - (day === 0 ? 6 : day - 1)); value.setHours(0, 0, 0, 0); return value;
}

export function unifiedHistoryGroupIdentity(record: UnifiedHistoryRecord, groupBy: UnifiedHistoryGroupBy) {
  const date = new Date(record.timestamp);
  let id = 'all'; let title = 'All history';
  if (groupBy === 'day') { id = date.toDateString(); title = date.toLocaleDateString(); }
  else if (groupBy === 'week' || groupBy === 'month') {
    const start = groupBy === 'week' ? startOfWeek(date) : new Date(date.getFullYear(), date.getMonth(), 1);
    id = start.toISOString(); title = groupBy === 'week'
      ? `${start.toLocaleDateString()} – ${new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6).toLocaleDateString()}`
      : start.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
  } else if (groupBy === 'cwd') {
    const cwd = record.cwd || 'no-cwd';
    id = record.connectionTarget ? `${record.connectionTarget}::${cwd}` : `${record.connection}::${cwd}`;
    title = record.cwd || t('No working directory');
    if (record.connectionTarget) title = `${record.connectionTarget} · ${title}`;
  } else if (groupBy === 'type') {
    id = record.connection; title = t(CONNECTION_LABELS[record.connection]);
  } else if (groupBy === 'terminal') {
    id = record.kind === 'conversation' ? 'ai' : record.terminalType.toLocaleLowerCase() || 'terminal';
    title = record.kind === 'workspace' ? t('Workspace combinations') : record.kind === 'agent' ? t('ACP sessions') : record.kind === 'conversation' ? t('AI conversations')
      : record.terminalType === 'ssh' ? t('SSH terminals')
        : record.terminalType === 'terminal' ? t('Terminal sessions') : `${record.terminalType.toLocaleUpperCase()} terminals`;
  }
  return { id, title };
}

/** Group the filtered records for the shared history card surface. */
export function groupUnifiedHistory(records: readonly UnifiedHistoryRecord[], groupBy: UnifiedHistoryGroupBy,
  pinnedIds: ReadonlySet<string>, meta: Pick<HistoryMetaState, 'groupTitles' | 'groupNotes' | 'collapsedGroups'>): UnifiedHistoryGroup[] {
  const groups = new Map<string, UnifiedHistoryGroup>();
  for (const record of records) {
    const { id, title } = unifiedHistoryGroupIdentity(record, groupBy);
    const key = `session/unified-${groupBy}/${id}`;
    const group = groups.get(id) ?? { id, title: meta.groupTitles[key] ?? title, originalTitle: title, subtitle: undefined, records: [], timestamp: 0 };
    group.records.push(record);
    group.timestamp = Math.max(group.timestamp, record.timestamp);
    groups.set(id, group);
  }
  return [...groups.values()].sort((left, right) => {
    const leftPinned = pinnedIds.has(left.id); const rightPinned = pinnedIds.has(right.id);
    if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
    return groupBy === 'cwd' || groupBy === 'type' || groupBy === 'terminal'
      ? left.title.localeCompare(right.title) : right.timestamp - left.timestamp;
  });
}
