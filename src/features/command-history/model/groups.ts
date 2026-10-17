import type { HistoryCommandGroup, HistoryCommandPreferences } from '@core/commandHistory';
import { commandKey, type CommandItem } from './commands';

/** Membership follows command identity so aliases and refreshed run ids stay stable. */
export function moveCommandToGroup(value: HistoryCommandPreferences, key: string, groupId: string | null): HistoryCommandPreferences {
  if (groupId && !value.groups?.some(group => group.id === groupId)) return value;
  return { ...value, groups: value.groups?.map(group => ({ ...group,
    commandKeys: [...group.commandKeys.filter(entry => entry !== key), ...(group.id === groupId ? [key] : [])],
  })) };
}

export function replaceGroupedCommand(value: HistoryCommandPreferences, previous: string | null, next: string | null): HistoryCommandPreferences {
  return { ...value, historyOrder: value.historyOrder?.flatMap(key => key === previous ? next ? [next] : [] : [key]), groups: value.groups?.map(group => ({ ...group,
    commandKeys: [...new Set(group.commandKeys.flatMap(key => key === previous ? next ? [next] : [] : [key]))],
  })) };
}

export function commandGroups(favorites: CommandItem[], history: CommandItem[], value: HistoryCommandPreferences) {
  const assigned = new Set<string>();
  const items = [...favorites, ...history];
  const groups = (value.groups ?? []).map(group => {
    const keys = new Set(group.commandKeys);
    const order = new Map(group.commandKeys.map((key, index) => [key, index]));
    const members = items.filter(item => keys.has(commandKey(item)) && !assigned.has(commandKey(item)))
      .sort((left, right) => order.get(commandKey(left))! - order.get(commandKey(right))!);
    members.forEach(item => assigned.add(commandKey(item)));
    return { ...group, items: members };
  });
  return { groups, favorites: favorites.filter(item => !assigned.has(commandKey(item))), history: history.filter(item => !assigned.has(commandKey(item))) };
}

/** Insert an identity relative to its target while keeping filtered-out entries. */
function insertKey(order: string[], key: string, targetKey?: string, after = false): string[] {
  const remaining = [...new Set(order)].filter(entry => entry !== key);
  const index = targetKey ? remaining.indexOf(targetKey) : -1;
  remaining.splice(index < 0 ? remaining.length : index + (after ? 1 : 0), 0, key);
  return remaining;
}

export function dropCommand(value: HistoryCommandPreferences, item: CommandItem, destination: string, targetKey?: string, after = false, historyOrder: string[] = []): HistoryCommandPreferences {
  const key = commandKey(item);
  const custom = destination !== 'favorites' && destination !== 'history';
  if (custom && !value.groups?.some(group => group.id === destination)) return value;
  const next = moveCommandToGroup(value, key, custom ? destination : null);
  if (custom) return { ...next, groups: next.groups?.map(group => group.id === destination
    ? { ...group, commandKeys: insertKey(value.groups?.find(entry => entry.id === destination)?.commandKeys ?? [], key, targetKey, after) } : group) };
  if (destination === 'history') return { ...next, favorites: next.favorites.filter(entry => commandKey(entry) !== key),
    historyOrder: insertKey([...historyOrder, ...next.historyOrder ?? []], key, targetKey, after) };
  const favorites = next.favorites.some(entry => commandKey(entry) === key) ? next.favorites
    : [...next.favorites, { id: crypto.randomUUID(), name: item.name, command: item.command, cwd: item.cwd, shell: item.shell }];
  const order = insertKey(favorites.map(commandKey), key, targetKey, after);
  return { ...next, favorites: order.map(entry => favorites.find(favorite => commandKey(favorite) === entry)!) };
}

export function reorderCommandGroups(value: HistoryCommandPreferences, sourceId: string, targetId: string, after = false): HistoryCommandPreferences {
  const order = commandGroupOrder(value);
  if (sourceId === 'history' || sourceId === targetId || !order.includes(sourceId) || !order.includes(targetId)) return value;
  const groupOrder = insertKey(order.filter(id => id !== 'history'), sourceId, targetId, after).concat('history');
  return { ...value, groupOrder, groups: [...value.groups ?? []].sort((a, b) => groupOrder.indexOf(a.id) - groupOrder.indexOf(b.id)) };
}

export function commandGroupOrder(value: HistoryCommandPreferences): string[] {
  const ids = ['favorites', ...value.groups?.map(group => group.id) ?? []];
  return [...new Set([...(value.groupOrder ?? []).filter(id => ids.includes(id)), ...ids]), 'history'];
}

/** Newly created history groups precede all sections without disturbing their saved order. */
export function prependCommandGroup(value: HistoryCommandPreferences, group: HistoryCommandGroup): HistoryCommandPreferences {
  const keys = new Set(group.commandKeys);
  return { ...value, groups: [group, ...value.groups ?? []].map(entry => entry.id === group.id ? entry
    : { ...entry, commandKeys: entry.commandKeys.filter(key => !keys.has(key)) }),
  groupOrder: [group.id, ...commandGroupOrder(value).filter(id => id !== group.id)] };
}

export function applyCommandGrouping(value: HistoryCommandPreferences, proposals: { name: string; itemIds: string[] }[], keys: ReadonlyMap<string, string>): HistoryCommandPreferences {
  const assigned = new Set(proposals.flatMap(group => group.itemIds.map(id => keys.get(id)).filter((key): key is string => !!key)));
  const groups = (value.groups ?? []).map(group => ({ ...group, commandKeys: group.commandKeys.filter(key => !assigned.has(key)) }));
  const created: HistoryCommandGroup[] = [];
  for (const proposal of proposals) {
    const commandKeys = proposal.itemIds.map(id => keys.get(id)).filter((key): key is string => !!key);
    if (!commandKeys.length) continue;
    const existing = [...created, ...groups].find(group => group.name.toLowerCase() === proposal.name.toLowerCase());
    if (existing) existing.commandKeys.push(...commandKeys);
    else created.push({ id: crypto.randomUUID(), name: proposal.name, commandKeys });
  }
  return created.reduceRight<HistoryCommandPreferences>((next, group) => prependCommandGroup(next, group), { ...value, groups });
}
