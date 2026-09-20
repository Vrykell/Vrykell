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
