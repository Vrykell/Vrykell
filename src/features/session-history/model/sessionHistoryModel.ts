import type { BackendGroupEntry, BackendSessionEntry } from '@platform/api/types';
import { filterSessions, type SessionDateFilter, type SessionTypeFilter, type SessionModeFilter } from '@features/session-history/model/filter';

export type SessionHistorySort = 'closed-desc' | 'closed-asc' | 'created-desc' | 'created-asc' | 'title-asc' | 'title-desc';

export interface SessionHistoryFilter {
  query: string;
  type: SessionTypeFilter;
  date: SessionDateFilter;
  mode?: SessionModeFilter;
  sort?: SessionHistorySort;
}

export const SESSION_MODE_OPTIONS: Array<{ value: SessionModeFilter; label: string }> = [
  { value: 'all', label: 'All modes' },
  { value: 'block', label: 'Block terminal' },
  { value: 'classic', label: 'Classic terminal' },
];

export const SESSION_SORT_OPTIONS: Array<{ value: SessionHistorySort; label: string }> = [
  { value: 'closed-desc', label: 'Recently closed' },
  { value: 'closed-asc', label: 'Earliest closed' },
  { value: 'created-desc', label: 'Recently created' },
  { value: 'created-asc', label: 'Earliest created' },
  { value: 'title-asc', label: 'Title A–Z' },
  { value: 'title-desc', label: 'Title Z–A' },
];

/** Stable sorting retains grouping and manual order when primary keys tie. */
export function sortHistoricalSessions(sessions: BackendSessionEntry[], sort: SessionHistorySort = 'closed-desc'): BackendSessionEntry[] {
  const compare = (a: BackendSessionEntry, b: BackendSessionEntry) => {
    let order: number;
    if (sort === 'title-asc' || sort === 'title-desc') order = a.title.localeCompare(b.title, undefined, { numeric: true }) * (sort === 'title-asc' ? 1 : -1);
    else {
      const aTime = sort.startsWith('created') ? a.created_at : a.closed_at ?? a.created_at;
      const bTime = sort.startsWith('created') ? b.created_at : b.closed_at ?? b.created_at;
      order = (aTime - bTime) * (sort.endsWith('asc') ? 1 : -1);
    }
    return order || a.sort_order - b.sort_order || a.id.localeCompare(b.id);
  };
  return [...sessions].sort(compare);
}

export const SESSION_TYPE_OPTIONS: Array<{ value: SessionTypeFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'local', label: '本地' },
  { value: 'ssh', label: 'SSH' },
];

export const SESSION_DATE_OPTIONS: Array<{ value: SessionDateFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'today', label: '今天' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
  { value: '90d', label: '近 90 天' },
];

export interface SessionHistorySections {
  historical: BackendSessionEntry[];
  grouped: Map<string, BackendSessionEntry[]>;
  ungrouped: BackendSessionEntry[];
}

export function deriveSessionHistorySections(
  sessions: BackendSessionEntry[],
  filter: SessionHistoryFilter,
): SessionHistorySections {
  const historical = filterSessions(
    sessions.filter((session) => session.status === 'historical'),
    filter.query,
    filter.type,
    filter.date,
    filter.mode,
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
  return filter.type !== 'all' || filter.date !== 'all' || (filter.mode !== undefined && filter.mode !== 'all');
}

export function groupsWithHistoricalSessions(
  groups: BackendGroupEntry[],
  sections: SessionHistorySections,
): BackendGroupEntry[] {
  return groups.filter((group) => (sections.grouped.get(group.id)?.length ?? 0) > 0);
}

/** Classic sessions have no command blocks; chat messages are counted separately. */
export function sessionCommandCount(session: BackendSessionEntry): number | null {
  try {
    const payload = JSON.parse(session.payload) as { layout?: import('@features/workspace/model/windowLayout').WindowLayout; openMode?: string; shellType?: string; ssh?: unknown };
    const modes: Array<string | undefined> = [];
    const walk = (layout: NonNullable<typeof payload.layout>) => {
      if (layout.type === 'leaf') modes.push(layout.terminal.openMode ?? (layout.terminal.shellType === 'cmd' ? 'classic' : undefined));
      else if (layout.type === 'split') { walk(layout.first); walk(layout.second); }
    };
    if (payload.layout) walk(payload.layout);
    else modes.push(payload.openMode ?? (payload.shellType === 'cmd' || payload.ssh || session.kind === 'ssh' ? 'classic' : undefined));
    if (modes.includes('block')) return session.block_count;
    if (modes.length > 0 && modes.every(mode => mode === 'classic')) return null;
  } catch { /* Legacy metadata has no reliable presentation mode. */ }
  return session.block_count > 0 ? session.block_count : null;
}
