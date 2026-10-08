import type { BackendGroupEntry, BackendSessionEntry } from '@platform/api/types';
import { filterSessions, type SessionDateFilter, type SessionTypeFilter } from '@features/session-history/model/filter';

export interface SessionHistoryFilter {
  query: string;
  type: SessionTypeFilter;
  date: SessionDateFilter;
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
  );
  const grouped = new Map<string, BackendSessionEntry[]>();
  const ungrouped = historical.filter((session) => !session.group_id).sort((left, right) => left.sort_order - right.sort_order);

  for (const group of historical.filter((session) => session.group_id)) {
    const groupId = group.group_id!;
    const items = grouped.get(groupId) ?? [];
    items.push(group);
    grouped.set(groupId, items);
  }
  for (const [groupId, items] of grouped) {
    grouped.set(groupId, items.sort((left, right) => left.sort_order - right.sort_order));
  }

  return { historical, grouped, ungrouped };
}

export function hasSessionHistoryFilter(filter: SessionHistoryFilter): boolean {
  return filter.type !== 'all' || filter.date !== 'all';
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
