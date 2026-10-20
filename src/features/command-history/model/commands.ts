import type { HistoryCommandEntry, HistoryCommandFavorite, HistoryCommandPreferences } from '@core/commandHistory';
import { normPath } from '@platform/path';

export const emptyPreferences = (): HistoryCommandPreferences => ({ favorites: [], hidden: [], rules: [] });
export function restoreRunningStatus(entries: HistoryCommandEntry[], active: Set<string>): HistoryCommandEntry[] {
  return entries.map(entry => entry.status === 'running' && !active.has(entry.id) ? { ...entry, status: 'unknown' } : entry);
}
export type CommandItem = HistoryCommandFavorite & { status?: HistoryCommandEntry['status']; timestamp?: number; runCount?: number };
export type CommandSort = 'recent' | 'frequent' | 'manual';

export function normalizeCommandPath(path: string): string {
  const value = normPath(path);
  return /^[a-z]:/i.test(value) ? value.toLowerCase() : value;
}
export function isWithin(path: string, root: string): boolean {
  if (!path || !root) return false;
  const p = normalizeCommandPath(path), r = normalizeCommandPath(root);
  if (!/^(?:[a-z]:\/|\/)/i.test(p) || !/^(?:[a-z]:\/|\/)/i.test(r) || /(?:^|\/)\.\.(?:\/|$)/.test(p) || /(?:^|\/)\.\.(?:\/|$)/.test(r)) return false;
  return p === r || p.startsWith(r.endsWith('/') ? r : `${r}/`);
}
export function commandKey(item: Pick<CommandItem, 'shell' | 'cwd' | 'command'>): string {
  return JSON.stringify([item.shell, normalizeCommandPath(item.cwd), item.command]);
}
export function isExcluded(item: CommandItem, preferences: HistoryCommandPreferences): boolean {
  return preferences.hidden.includes(commandKey(item)) || item.runCount !== 0 && preferences.rules.some(rule => rule.kind === 'prefix'
    ? item.command.trimStart().startsWith(rule.value)
    : item.command.trimStart().split(/\s+/)[0] === rule.value);
}
/** `shell` keeps only commands recorded in that shell, i.e. the ones a terminal in the same environment can execute. */
export function projectItems(history: HistoryCommandEntry[], preferences: HistoryCommandPreferences, query: string, status: string, cwd?: string, sort: CommandSort = 'recent', organizedOnly = false, shell?: string) {
  const search = query.trim().toLowerCase();
  const favoriteKeys = new Set(preferences.favorites.map(commandKey));
  const groupedKeys = new Set(preferences.groups?.flatMap(group => group.commandKeys));
  const matchingGroupKeys = new Set(preferences.groups?.filter(group => group.name.toLowerCase().includes(search)).flatMap(group => group.commandKeys));
  const order = new Map(preferences.historyOrder?.map((key, index) => [key, index]));
  const match = (item: CommandItem) => (!cwd || normalizeCommandPath(item.cwd) === normalizeCommandPath(cwd))
    && (!shell || item.shell === shell)
    && (status === 'all' || item.status === status)
    && (!organizedOnly || favoriteKeys.has(commandKey(item)) || groupedKeys.has(commandKey(item)))
    && (`${item.name} ${item.command} ${item.cwd}`.toLowerCase().includes(search) || matchingGroupKeys.has(commandKey(item)));
  const entries: CommandItem[] = history.map(entry => ({ ...entry, name: entry.name || entry.command }));
  const favorites = preferences.favorites.map(favorite => ({ ...entries.find(item => commandKey(item) === commandKey(favorite)), ...favorite, name: favorite.name || favorite.command }));
  const keys = new Set(favorites.map(commandKey));
  return {
    favorites: favorites.filter(match),
    history: entries.filter(item => !keys.has(commandKey(item)) && !isExcluded(item, preferences) && match(item))
      .sort((left, right) => (sort === 'manual' ? (order.get(commandKey(left)) ?? Number.MAX_SAFE_INTEGER) - (order.get(commandKey(right)) ?? Number.MAX_SAFE_INTEGER)
        : sort === 'frequent' ? (right.runCount ?? 0) - (left.runCount ?? 0) : 0) || (right.timestamp ?? 0) - (left.timestamp ?? 0)),
    hidden: entries.filter(item => isExcluded(item, preferences)),
  };
}
