import { expect, it } from 'vitest';
import { commandKey, emptyPreferences, type CommandItem } from '../model/commands';
import { applyCommandGrouping, commandGroupOrder, commandGroups, dropCommand, moveCommandToGroup, prependCommandGroup, reorderCommandGroups, replaceGroupedCommand } from '../model/groups';

const first: CommandItem = { id: 'one', name: 'Build', command: 'npm run build', cwd: '/app', shell: 'bash' };
const second: CommandItem = { ...first, id: 'two', name: 'Tests', command: 'cargo test' };
const value = () => ({ ...emptyPreferences(), groups: [
  { id: 'build', name: 'Build', commandKeys: [commandKey(first)] },
  { id: 'other', name: 'Other', commandKeys: [] as string[] },
] });

it('moves commands between groups without changing commands or duplicating membership', () => {
  const original = value();
  const moved = moveCommandToGroup(original, commandKey(first), 'other');
  expect(moved.groups?.map(group => group.commandKeys)).toEqual([[], [commandKey(first)]]);
  expect(original.groups[0]!.commandKeys).toEqual([commandKey(first)]);
  expect(moveCommandToGroup(moved, commandKey(first), null).groups?.every(group => !group.commandKeys.length)).toBe(true);
  expect(moveCommandToGroup(original, commandKey(first), 'missing')).toBe(original);
});

it('keeps grouped favorites and history unique and leaves unassigned commands in their original sections', () => {
  const grouped = commandGroups([first], [second], value());
  expect(grouped.groups[0]?.items).toEqual([first]);
  expect(grouped.favorites).toEqual([]);
  expect(grouped.history).toEqual([second]);
  expect(grouped.groups[1]?.items).toEqual([]);
  expect(commandGroups([first], [second], emptyPreferences()).favorites).toEqual([first]);
});

it('retains group identity after an edit and removes membership on deletion', () => {
  const next = commandKey(second);
  const edited = replaceGroupedCommand(value(), commandKey(first), next);
  expect(edited.groups?.[0]?.commandKeys).toEqual([next]);
  expect(replaceGroupedCommand(edited, next, null).groups?.[0]?.commandKeys).toEqual([]);
});

it('does not duplicate a command when stored groups contain overlapping membership', () => {
  const preferences = value();
  preferences.groups[1]!.commandKeys.push(commandKey(first));
  const grouped = commandGroups([], [first, second], preferences);
  expect(grouped.groups.flatMap(group => group.items)).toEqual([first]);
  expect(grouped.history).toEqual([second]);
});

it('orders group commands by their saved keys and moves rows across empty groups', () => {
  const preferences = value();
  const next = dropCommand(preferences, second, 'build', commandKey(first));
  expect(commandGroups([], [first, second], next).groups[0]?.items).toEqual([second, first]);
  const moved = dropCommand(next, second, 'other');
  expect(commandGroups([], [first, second], moved).groups[1]?.items).toEqual([second]);
  expect(preferences.groups[1]?.commandKeys).toEqual([]);
});

it('supports dragging into favorites and back to manual history without duplicating entries', () => {
  const favorite = dropCommand(value(), second, 'favorites');
  expect(favorite.favorites.map(commandKey)).toEqual([commandKey(second)]);
  const history = dropCommand(favorite, second, 'history', commandKey(first), false, [commandKey(first)]);
  expect(history.favorites).toEqual([]);
  expect(history.historyOrder).toEqual([commandKey(second), commandKey(first)]);
  expect(replaceGroupedCommand(history, commandKey(second), null).historyOrder).toEqual([commandKey(first)]);
});

it('reorders custom groups without altering their contents or colors', () => {
  const preferences = { ...value(), groupColors: { build: 'blue' } };
  const reordered = reorderCommandGroups(preferences, 'other', 'build');
  expect(reordered.groups?.map(group => group.id)).toEqual(['other', 'build']);
  expect(reordered.groupColors).toEqual(preferences.groupColors);
  expect(preferences.groups[0]?.id).toBe('build');
});

it('prepends each new group before saved built-in and custom sections while preserving their order', () => {
  const preferences = reorderCommandGroups(value(), 'history', 'favorites');
  const added = prependCommandGroup(preferences, { id: 'new', name: 'New', commandKeys: [commandKey(first)] });
  expect(commandGroupOrder(added)).toEqual(['new', 'favorites', 'build', 'other', 'history']);
  expect(added.groups?.map(group => group.id)).toEqual(['new', 'build', 'other']);
  expect(added.groups?.[0]?.commandKeys).toEqual([commandKey(first)]);
  expect(added.groups?.[1]?.commandKeys).toEqual([]);
  expect(preferences.groups?.[0]?.commandKeys).toEqual([commandKey(first)]);
  const next = prependCommandGroup(added, { id: 'newer', name: 'Newer', commandKeys: [] });
  expect(commandGroupOrder(next)).toEqual(['newer', 'new', 'favorites', 'build', 'other', 'history']);
});

it('prepends new AI groups in proposal order and retains the positions of reused groups', () => {
  const preferences = reorderCommandGroups(value(), 'history', 'favorites');
  const result = applyCommandGrouping(preferences, [{ name: 'New A', itemIds: ['one'] }, { name: 'New B', itemIds: ['two'] }],
    new Map([['one', commandKey(first)], ['two', commandKey(second)]]));
  expect(result.groups?.map(group => group.name)).toEqual(['New A', 'New B', 'Build', 'Other']);
  expect(commandGroupOrder(result).slice(2)).toEqual(commandGroupOrder(preferences));
  expect(commandGroupOrder(result).slice(0, 2)).toEqual(result.groups?.slice(0, 2).map(group => group.id));
});

it('fixes ungrouped commands at the end and applies reviewed membership without losing colors', () => {
  const ordered = reorderCommandGroups(value(), 'history', 'favorites');
  expect(ordered).toEqual(value());
  expect(commandGroupOrder({ ...value(), groupOrder: ['history', 'other', 'favorites'] })).toEqual(['other', 'favorites', 'build', 'history']);
  expect(commandGroupOrder(reorderCommandGroups(value(), 'favorites', 'history', true))).toEqual(['build', 'other', 'favorites', 'history']);
  const preferences = { ...value(), groupColors: { build: 'blue' } };
  const result = applyCommandGrouping(preferences, [{ name: 'Other', itemIds: ['one'] }], new Map([['one', commandKey(first)]]));
  expect(result.groups?.map(group => group.commandKeys)).toEqual([[], [commandKey(first)]]);
  expect(result.groupColors).toEqual({ build: 'blue' });
  expect(preferences.groups[0]!.commandKeys).toEqual([commandKey(first)]);
});
