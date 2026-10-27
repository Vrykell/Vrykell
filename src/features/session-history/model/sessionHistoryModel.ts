import type { BackendGroupEntry, BackendSessionEntry } from '@platform/api/types';
import { filterSessions, isSshSession, sshTargetOf, type SessionDateFilter, type SessionTypeFilter, type SessionModeFilter } from '@features/session-history/model/filter';
import { t } from '@i18n';
import { shellTypeLabel } from '@platform/shells';
import { historyDirectory } from '@utils/historyDirectory';
import { sessionHistoryTerminals } from './sessionMetadata';

export type SessionHistorySort = 'closed-desc' | 'closed-asc' | 'created-desc' | 'created-asc' | 'title-asc' | 'title-desc';
export type SessionHistoryGroupBy = 'day' | 'week' | 'month' | 'cwd' | 'type' | 'terminal' | 'none';

export interface SessionHistoryCardGroup {
  id: string;
  title: string;
  sessions: BackendSessionEntry[];
  originalGroup?: BackendGroupEntry;
  categoryTitle?: string;
  totalCount?: number;
  timestamp?: number;
}

export interface SessionHistoryFilter {
  query: string;
  type: SessionTypeFilter;
  date: SessionDateFilter;
  mode?: SessionModeFilter;
  sort?: SessionHistorySort;
  groupBy?: SessionHistoryGroupBy;
  dateField?: 'created' | 'closed';
  starredOnly?: boolean;
}

/** Title sorting retains the date basis; time sorting and date-basis choices stay synchronized. */
export function updateSessionHistoryFilter(previous: SessionHistoryFilter, patch: Partial<SessionHistoryFilter>): SessionHistoryFilter {
  let sort = patch.sort ?? previous.sort ?? 'closed-desc';
  const dateField = patch.dateField ?? (patch.sort && !patch.sort.startsWith('title')
    ? sessionHistoryDateField(patch.sort) : previous.dateField ?? sessionHistoryDateField(previous.sort));
  if (patch.dateField && !sort.startsWith('title')) sort = `${dateField}-${sort.endsWith('asc') ? 'asc' : 'desc'}`;
  return { ...previous, ...patch, dateField, sort };
}

export const SESSION_GROUP_BY_OPTIONS = [
  { value: 'day', label: 'By day' },
  { value: 'week', label: 'By week' },
  { value: 'month', label: 'By month' },
  { value: 'cwd', label: 'Working directory' },
  { value: 'type', label: 'Connection type' },
  { value: 'terminal', label: 'Terminal type' },
  { value: 'none', label: 'No grouping' },
] as const satisfies readonly { value: SessionHistoryGroupBy; label: string }[];

export const SESSION_MODE_OPTIONS = [
  { value: 'all', label: 'All modes' },
  { value: 'block', label: 'Block terminal' },
  { value: 'classic', label: 'Classic terminal' },
] as const satisfies readonly { value: SessionModeFilter; label: string }[];

export const SESSION_SORT_OPTIONS = [
  { value: 'closed-desc', label: 'Recently closed' },
  { value: 'closed-asc', label: 'Earliest closed' },
  { value: 'created-desc', label: 'Recently created' },
  { value: 'created-asc', label: 'Earliest created' },
  { value: 'title-asc', label: 'Title A–Z' },
  { value: 'title-desc', label: 'Title Z–A' },
] as const satisfies readonly { value: SessionHistorySort; label: string }[];

/** Stable sorting retains grouping and manual order when primary keys tie. */
export function sortHistoricalSessions(sessions: BackendSessionEntry[], sort: SessionHistorySort = 'closed-desc'): BackendSessionEntry[] {
  const compare = (a: BackendSessionEntry, b: BackendSessionEntry) => {
    let order: number;
    if (sort === 'title-asc' || sort === 'title-desc') order = a.title.localeCompare(b.title, undefined, { numeric: true }) * (sort === 'title-asc' ? 1 : -1);
    else {
      const aTime = sessionHistoryTimestamp(a, sort);
      const bTime = sessionHistoryTimestamp(b, sort);
      order = (aTime - bTime) * (sort.endsWith('asc') ? 1 : -1);
    }
    return order || a.sort_order - b.sort_order || a.id.localeCompare(b.id);
  };
  return [...sessions].sort(compare);
}

function startOfWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayFromMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - dayFromMonday);
  return start;
}

export function sessionHistoryDateField(sort: SessionHistorySort = 'closed-desc'): 'created' | 'closed' {
  return sort.startsWith('created') ? 'created' : 'closed';
}

/** Date filtering, time grouping and card metadata share the selected time field. */
export function sessionHistoryTimestamp(session: BackendSessionEntry, sort: SessionHistorySort = 'closed-desc', dateField = sessionHistoryDateField(sort)): number {
  return dateField === 'created' ? session.created_at : session.closed_at ?? session.created_at;
}

function dateTitle(timestamp: number, groupBy: Extract<SessionHistoryGroupBy, 'day' | 'week' | 'month'>): string {
  const date = new Date(timestamp);
  if (groupBy === 'day') {
    const today = new Date();
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return t('Today');
    if (date.toDateString() === yesterday.toDateString()) return t('Yesterday');
    return date.toLocaleDateString();
  }
  if (groupBy === 'week') return t('Week of {{date}}', { date: startOfWeek(date).toLocaleDateString() });
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
}

export function sessionHistoryDirectories(session: BackendSessionEntry): Array<{ id: string; title: string }> {
  return [...new Map(sessionHistoryTerminals(session).map(terminal => {
    const directory = historyDirectory(terminal, t(terminal.kind === 'ssh' ? 'Working directory not recorded' : 'No working directory'));
    return [directory.id, directory] as const;
  })).values()];
}

function sessionGroup(
  session: BackendSessionEntry,
  groupBy: SessionHistoryGroupBy,
  sort: SessionHistorySort,
  dateField: 'created' | 'closed',
): Omit<SessionHistoryCardGroup, 'sessions'> {
  if (groupBy === 'cwd') {
    const directories = sessionHistoryDirectories(session);
    return directories.length > 1 ? { id: 'cwd:multiple', title: t('Multiple working directories') } : directories[0];
  }
  if (groupBy === 'type') {
    const types = new Set(sessionHistoryTerminals(session).map(terminal => terminal.kind));
    const type = types.size > 1 ? 'mixed' : isSshSession(session) ? 'ssh' : 'local';
    return { id: `type:${type}`, title: type === 'mixed' ? t('Mixed connections') : t(type === 'ssh' ? 'SSH' : 'Local') };
  }
  if (groupBy === 'terminal') {
    const types = new Set(sessionHistoryTerminals(session).map(terminal => terminal.kind === 'ssh' ? 'ssh' : terminal.shellType?.trim() || 'default'));
    const type = types.size > 1 ? 'mixed' : [...types][0];
    const title = type === 'mixed' ? t('Mixed terminal types') : type === 'default' ? t('Default terminal')
      : type === 'ssh' ? 'SSH' : shellTypeLabel(type);
    return { id: `terminal:${type}`, title };
  }
  if (groupBy === 'none') return { id: 'all', title: t('All sessions') };

  const timestamp = sessionHistoryTimestamp(session, sort, dateField);
  const date = new Date(timestamp);
  if (groupBy === 'day') return { id: `day:${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`, title: dateTitle(timestamp, groupBy) };
  if (groupBy === 'week') {
    const start = startOfWeek(date);
    return { id: `week:${start.getFullYear()}-${start.getMonth()}-${start.getDate()}`, title: dateTitle(timestamp, groupBy) };
  }
  return { id: `month:${date.getFullYear()}-${date.getMonth()}`, title: dateTitle(timestamp, groupBy) };
}

/** Filters determine membership; category names and calendar dates determine card order. */
export function groupHistoricalSessions(
  sessions: BackendSessionEntry[],
  groupBy: SessionHistoryGroupBy = 'day',
  sort: SessionHistorySort = 'closed-desc',
  dateField = sessionHistoryDateField(sort),
  /** Group ids pinned to the top of this grouping mode. */
  pinnedIds: ReadonlySet<string> | null = null,
  source?: { groups: readonly BackendGroupEntry[]; sessions: readonly BackendSessionEntry[] },
): SessionHistoryCardGroup[] {
  if (source) {
    const originals = new Map(source.groups.map(group => [group.id, group]));
    const loose = sessions.filter(session => !session.group_id || !originals.has(session.group_id));
    const cards = groupHistoricalSessions(loose, groupBy, sort, dateField);
    for (const original of source.groups) {
      const matching = sessions.filter(session => session.group_id === original.id);
      if (!matching.length) continue;
      // Classify the original container using all historical members so filters never move or split it.
      const savedMembers = source.sessions.filter(session => session.status === 'historical' && session.group_id === original.id);
      const members = savedMembers.length ? savedMembers : matching;
      const classifications = groupHistoricalSessions(members, groupBy, sort, dateField);
      const timestamp = Math.max(...members.map(session => sessionHistoryTimestamp(session, sort, dateField)));
      const timeGrouped = groupBy === 'day' || groupBy === 'week' || groupBy === 'month';
      const category = timeGrouped ? sessionGroup(members.find(session => sessionHistoryTimestamp(session, sort, dateField) === timestamp)!, groupBy, sort, dateField)
        : classifications.length === 1 ? classifications[0]
        : { title: t(groupBy === 'cwd' ? 'Multiple working directories' : groupBy === 'terminal' ? 'Mixed terminal types' : 'Mixed connections') };
      cards.push({ id: `source:${original.id}`, title: original.title, sessions: sortHistoricalSessions(matching, sort),
        originalGroup: original, categoryTitle: groupBy === 'none' ? undefined : category.title, totalCount: members.length, timestamp });
    }
    const timeGrouped = groupBy === 'day' || groupBy === 'week' || groupBy === 'month';
    cards.sort((left, right) => {
      if (timeGrouped) return ((left.timestamp ?? Math.max(...left.sessions.map(session => sessionHistoryTimestamp(session, sort, dateField))))
        - (right.timestamp ?? Math.max(...right.sessions.map(session => sessionHistoryTimestamp(session, sort, dateField)))))
        * (sort.endsWith('asc') && !sort.startsWith('title') ? 1 : -1) || left.id.localeCompare(right.id);
      return (left.categoryTitle ?? left.title).localeCompare(right.categoryTitle ?? right.title, undefined, { numeric: true })
        || left.title.localeCompare(right.title, undefined, { numeric: true }) || left.id.localeCompare(right.id);
    });
    return pinnedIds?.size ? [...cards.filter(card => pinnedIds.has(card.id)), ...cards.filter(card => !pinnedIds.has(card.id))] : cards;
  }
  const cards = new Map<string, SessionHistoryCardGroup>();
  for (const session of sortHistoricalSessions(sessions, sort)) {
    const group = sessionGroup(session, groupBy, sort, dateField);
    const card = cards.get(group.id) ?? { ...group, sessions: [] };
    card.sessions.push(session);
    cards.set(group.id, card);
  }
  const timeGrouped = groupBy === 'day' || groupBy === 'week' || groupBy === 'month';
  const ordered = [...cards.values()].sort((left, right) => timeGrouped
    ? (sessionHistoryTimestamp(left.sessions[0], sort, dateField) - sessionHistoryTimestamp(right.sessions[0], sort, dateField)) * (sort.endsWith('asc') && !sort.startsWith('title') ? 1 : -1)
    : left.title.localeCompare(right.title, undefined, { numeric: true }) || left.id.localeCompare(right.id));
  if (!pinnedIds?.size) return ordered;
  return [...ordered.filter((group) => pinnedIds.has(group.id)), ...ordered.filter((group) => !pinnedIds.has(group.id))];
}

export const SESSION_TYPE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'local', label: 'Local' },
  { value: 'ssh', label: 'SSH' },
] as const satisfies readonly { value: SessionTypeFilter; label: string }[];

export const SESSION_DATE_OPTIONS = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
] as const satisfies readonly { value: SessionDateFilter; label: string }[];

export interface SessionHistorySections {
  historical: BackendSessionEntry[];
  grouped: Map<string, BackendSessionEntry[]>;
  ungrouped: BackendSessionEntry[];
}

export function deriveSessionHistorySections(
  sessions: BackendSessionEntry[],
  filter: SessionHistoryFilter,
  /** Full set of starred session ids; only applied while starred-only filtering is on. */
  starredIds: ReadonlySet<string> | null = null,
  searchAnnotations: ReadonlyMap<string, string> | null = null,
): SessionHistorySections {
  const historical = filterSessions(
    sessions.filter((session) => session.status === 'historical'),
    filter.query,
    filter.type,
    filter.date,
    filter.mode,
    filter.dateField ?? sessionHistoryDateField(filter.sort),
    filter.starredOnly ? starredIds : null,
    searchAnnotations,
  );
  const grouped = new Map<string, BackendSessionEntry[]>();
  const ungrouped = sortHistoricalSessions(historical.filter((session) => !session.group_id), filter.sort);

  for (const group of historical.filter((session) => session.group_id)) {
    const groupId = group.group_id!;
    const items = grouped.get(groupId) ?? [];
    items.push(group);
    grouped.set(groupId, items);
  }
  for (const [groupId, items] of grouped) {
    grouped.set(groupId, sortHistoricalSessions(items, filter.sort));
  }

  return { historical, grouped, ungrouped };
}

export function hasSessionHistoryFilter(filter: SessionHistoryFilter): boolean {
  return filter.type !== 'all' || filter.date !== 'all' || (filter.mode !== undefined && filter.mode !== 'all') || filter.starredOnly === true;
}

/** Classic sessions have no command blocks; chat messages are counted separately. */
export function sessionCommandCount(session: BackendSessionEntry): number | null {
  try {
    const payload = JSON.parse(session.payload) as { layout?: import('@features/workspace/model/windowLayout').WindowLayout };
    const modes: Array<string | undefined> = [];
    const walk = (layout: NonNullable<typeof payload.layout>) => {
      if (layout.type === 'leaf') modes.push(layout.terminal.openMode ?? (layout.terminal.shellType === 'cmd' ? 'classic' : undefined));
      else if (layout.type === 'split') { walk(layout.first); walk(layout.second); }
    };
    if (payload.layout) walk(payload.layout);
    if (modes.includes('block')) return session.block_count;
    if (modes.length > 0 && modes.every(mode => mode === 'classic')) return null;
  } catch { /* A corrupt payload has no reliable presentation mode. */ }
  return session.block_count > 0 ? session.block_count : null;
}

/** Plain-text session summary used by the copy action; labels stay in English like other exports. */
export function sessionSummaryText(session: BackendSessionEntry): string {
  const terminals = sessionHistoryTerminals(session);
  const kinds = [...new Set(terminals.map(terminal => terminal.kind === 'ssh' ? 'SSH' : terminal.shellType?.trim() || 'Terminal'))];
  const lines = [session.title || t('Untitled session'), `Type: ${kinds.join(', ')}`];
  const target = sshTargetOf(session);
  if (target) lines.push(`Target: ${target}`);
  const directories = sessionHistoryDirectories(session).map(directory => directory.title);
  if (directories.length) lines.push(`Directories: ${directories.join(', ')}`);
  lines.push(`Created: ${new Date(session.created_at).toLocaleString()}`);
  if (session.closed_at) lines.push(`Closed: ${new Date(session.closed_at).toLocaleString()}`);
  const count = sessionCommandCount(session);
  if (count !== null) lines.push(`Command blocks: ${count}`);
  return lines.join('\n');
}
