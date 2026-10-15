import type { Conversation } from './conversation';
import { t } from '@i18n';
import { shellTypeLabel } from '@platform/shells';
import { historyDirectory } from '@utils/historyDirectory';

export type ConversationTypeFilter = 'all' | 'discussion' | 'local' | 'ssh';
export type ConversationDateFilter = 'all' | 'today' | '7d' | '30d' | '90d';
export type ConversationHistorySort = 'updated-desc' | 'updated-asc' | 'created-desc' | 'created-asc' | 'title-asc' | 'title-desc';
export type ConversationHistoryGroupBy = 'day' | 'week' | 'month' | 'cwd' | 'type' | 'terminal' | 'none';

export interface ConversationHistoryGroup {
  id: string;
  title: string;
  items: Conversation[];
}

export interface ConversationHistoryFilter {
  query: string;
  type: ConversationTypeFilter;
  date: ConversationDateFilter;
  sort: ConversationHistorySort;
  groupBy: ConversationHistoryGroupBy;
  dateField?: 'created' | 'updated';
  starredOnly: boolean;
}

export const DEFAULT_CONVERSATION_HISTORY_FILTER: ConversationHistoryFilter = {
  query: '', type: 'all', date: 'all', sort: 'updated-desc', groupBy: 'day', dateField: 'updated', starredOnly: false,
};

export function updateConversationHistoryFilter(previous: ConversationHistoryFilter, patch: Partial<ConversationHistoryFilter>): ConversationHistoryFilter {
  let sort = patch.sort ?? previous.sort;
  const dateField = patch.dateField ?? (patch.sort && !patch.sort.startsWith('title')
    ? conversationHistoryDateField(patch.sort) : previous.dateField ?? conversationHistoryDateField(previous.sort));
  if (patch.dateField && !sort.startsWith('title')) sort = `${dateField}-${sort.endsWith('asc') ? 'asc' : 'desc'}`;
  return { ...previous, ...patch, dateField, sort };
}

export const CONVERSATION_GROUP_BY_OPTIONS = [
  { value: 'day', label: 'By day' },
  { value: 'week', label: 'By week' },
  { value: 'month', label: 'By month' },
  { value: 'cwd', label: 'Working directory' },
  { value: 'type', label: 'Conversation type' },
  { value: 'terminal', label: 'Terminal type' },
  { value: 'none', label: 'No grouping' },
] as const satisfies readonly { value: ConversationHistoryGroupBy; label: string }[];

const DATE_MS: Record<Exclude<ConversationDateFilter, 'all' | 'today'>, number> = {
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

export function conversationHistoryDateField(sort: ConversationHistorySort): 'created' | 'updated' {
  return sort.startsWith('created') ? 'created' : 'updated';
}

export function conversationHistoryTimestamp(conversation: Conversation, sort: ConversationHistorySort, dateField = conversationHistoryDateField(sort)): number {
  return dateField === 'created' ? conversation.createdAt : conversation.updatedAt;
}

function matchesDate(conversation: Conversation, range: ConversationDateFilter, sort: ConversationHistorySort, dateField = conversationHistoryDateField(sort)): boolean {
  if (range === 'all') return true;
  if (range === 'today') {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    return conversationHistoryTimestamp(conversation, sort, dateField) >= dayStart.getTime();
  }
  return conversationHistoryTimestamp(conversation, sort, dateField) >= Date.now() - DATE_MS[range];
}

/** Apply the metadata search, target/date filters and stable sort for AI history. */
export function filterConversations(
  conversations: Conversation[],
  filter: ConversationHistoryFilter,
  /** When provided, only records whose id is in this set are kept (starred-only filtering). */
  starredIds: ReadonlySet<string> | null = null,
  searchAnnotations: ReadonlyMap<string, string> | null = null,
): Conversation[] {
  const normalizedQuery = filter.query.trim().toLocaleLowerCase();
  const filtered = conversations.filter(conversation => {
    if (starredIds && !starredIds.has(conversation.id)) return false;
    if (filter.type === 'discussion' && conversation.environment) return false;
    if ((filter.type === 'local' || filter.type === 'ssh') && conversation.environment?.kind !== filter.type) return false;
    if (!matchesDate(conversation, filter.date, filter.sort, filter.dateField)) return false;
    if (!normalizedQuery) return true;
    const target = conversation.environment?.ssh;
    const haystack = [conversation.title, conversation.environment?.label ?? '', conversation.environment?.cwd ?? '', target?.host ?? '', target?.user ?? '', searchAnnotations?.get(conversation.id) ?? '']
      .join(' ').toLocaleLowerCase();
    return haystack.includes(normalizedQuery);
  });

  const compare = (left: Conversation, right: Conversation) => {
    if (filter.sort === 'title-asc' || filter.sort === 'title-desc') {
      return left.title.localeCompare(right.title, undefined, { numeric: true }) * (filter.sort === 'title-asc' ? 1 : -1) || left.id.localeCompare(right.id);
    }
    const field = filter.sort.startsWith('created') ? 'createdAt' : 'updatedAt';
    return (left[field] - right[field]) * (filter.sort.endsWith('asc') ? 1 : -1) || left.id.localeCompare(right.id);
  };
  return filtered.sort(compare);
}

export function hasConversationHistoryFilter(filter: ConversationHistoryFilter): boolean {
  return filter.type !== 'all' || filter.date !== 'all' || filter.starredOnly;
}

function startOfWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayFromMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - dayFromMonday);
  return start;
}

function dateTitle(timestamp: number, groupBy: Extract<ConversationHistoryGroupBy, 'day' | 'week' | 'month'>): string {
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

function conversationGroup(conversation: Conversation, groupBy: ConversationHistoryGroupBy, sort: ConversationHistorySort, dateField: 'created' | 'updated'): { id: string; title: string } {
  const timestamp = conversationHistoryTimestamp(conversation, sort, dateField);
  const date = new Date(timestamp);
  if (groupBy === 'day') return { id: `day:${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`, title: dateTitle(timestamp, groupBy) };
  if (groupBy === 'week') {
    const start = startOfWeek(date);
    return { id: `week:${start.getFullYear()}-${start.getMonth()}-${start.getDate()}`, title: dateTitle(timestamp, groupBy) };
  }
  if (groupBy === 'month') return { id: `month:${date.getFullYear()}-${date.getMonth()}`, title: dateTitle(timestamp, groupBy) };
  if (groupBy === 'cwd') {
    if (!conversation.environment) return { id: 'cwd:discussion', title: t('Discussion only') };
    return historyDirectory({ ...conversation.environment, remoteId: conversation.environment.paneId, remoteLabel: conversation.environment.label },
      t(conversation.environment.kind === 'ssh' ? 'Working directory not recorded' : 'No working directory'));
  }
  if (groupBy === 'type') {
    const type = conversation.environment?.kind ?? 'discussion';
    return { id: `type:${type}`, title: type === 'discussion' ? t('Discussion only') : t(type === 'ssh' ? 'SSH' : 'Local') };
  }
  if (groupBy === 'terminal') {
    const environment = conversation.environment;
    const type = !environment ? 'discussion' : environment.kind === 'ssh' ? 'ssh' : environment.shellType || 'default';
    return { id: `terminal:${type}`, title: type === 'discussion' ? t('Discussion only')
      : type === 'default' ? t('Default terminal') : type === 'ssh' ? 'SSH' : shellTypeLabel(type) };
  }
  return { id: 'all', title: t('All conversations') };
}

/** Calendar cards retain date order; category cards retain name order as record sorting changes. */
export function groupConversations(
  conversations: Conversation[],
  groupBy: ConversationHistoryGroupBy,
  sort: ConversationHistorySort = 'updated-desc',
  dateField = conversationHistoryDateField(sort),
  /** Group ids pinned to the top of this grouping mode. */
  pinnedIds: ReadonlySet<string> | null = null,
): ConversationHistoryGroup[] {
  const groups = new Map<string, ConversationHistoryGroup>();
  for (const conversation of conversations) {
    const { id, title } = conversationGroup(conversation, groupBy, sort, dateField);
    const group = groups.get(id) ?? { id, title, items: [] };
    group.items.push(conversation);
    groups.set(id, group);
  }
  const timeGrouped = groupBy === 'day' || groupBy === 'week' || groupBy === 'month';
  const ordered = [...groups.values()].sort((left, right) => timeGrouped
    ? (conversationHistoryTimestamp(left.items[0], sort, dateField) - conversationHistoryTimestamp(right.items[0], sort, dateField)) * (sort.endsWith('asc') && !sort.startsWith('title') ? 1 : -1)
    : left.title.localeCompare(right.title, undefined, { numeric: true }) || left.id.localeCompare(right.id));
  if (!pinnedIds?.size) return ordered;
  return [...ordered.filter((group) => pinnedIds.has(group.id)), ...ordered.filter((group) => !pinnedIds.has(group.id))];
}

/** Markdown export used by the copy action; section labels stay in English like other exports. */
export function conversationMarkdown(conversation: Conversation, messages: Array<{ role: string; content: string }>): string {
  const environment = conversation.environment;
  const lines = [`# ${conversation.title}`, ''];
  if (environment) lines.push(`Environment: ${environment.label}${environment.cwd ? ` · ${environment.cwd}` : ''}`, '');
  lines.push(`Created: ${new Date(conversation.createdAt).toLocaleString()}`, `Updated: ${new Date(conversation.updatedAt).toLocaleString()}`);
  for (const message of messages) {
    lines.push('', message.role === 'assistant' ? '## Assistant' : '## User', '', message.content);
  }
  return lines.join('\n');
}
