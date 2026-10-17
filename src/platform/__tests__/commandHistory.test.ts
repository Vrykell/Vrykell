import { beforeEach, expect, it, vi } from 'vitest';
import { getHistoryPreferences, saveHistoryPreferences } from '../api/commandHistory';
import type { HistoryCommandPreferences } from '@core/commandHistory';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@platform/diagnostics', () => ({ invoke }));
beforeEach(() => invoke.mockReset());
const preferences = (): HistoryCommandPreferences => ({ favorites: [], hidden: [], rules: [], runIn: 'new' });

it('serializes saves and waits for pending changes before a remounted panel reads them', async () => {
  let release: () => void = () => {};
  let stored = preferences();
  let saves = 0;
  invoke.mockImplementation(async (command: string, args: { payload: HistoryCommandPreferences }) => {
    if (command === 'command_history_save_preferences') {
      if (++saves === 1) await new Promise<void>(resolve => { release = resolve; });
      stored = args.payload;
      return;
    }
    return stored;
  });
  const first = saveHistoryPreferences('serialized', preferences());
  const last = saveHistoryPreferences('serialized', { ...preferences(), runIn: 'current' });
  const read = getHistoryPreferences('serialized');
  await vi.waitFor(() => expect(saves).toBe(1));
  expect(invoke).toHaveBeenCalledTimes(1);
  release();
  await Promise.all([first, last]);
  expect(await read).toMatchObject({ runIn: 'current' });
});

it('reports malformed saved preferences instead of rendering corrupt command lists', async () => {
  invoke.mockResolvedValue({ ...preferences(), favorites: null });
  await expect(getHistoryPreferences('invalid')).rejects.toThrow('Invalid command history preferences');
});

it('accepts old preferences and validates optional command groups and colors', async () => {
  invoke.mockResolvedValue(preferences());
  expect(await getHistoryPreferences('old')).toEqual(preferences());
  const grouped = { ...preferences(), groups: [{ id: 'build', name: 'Build', commandKeys: ['key'] }], groupColors: { build: 'blue' }, historyOrder: ['key'] };
  invoke.mockResolvedValue(grouped);
  expect(await getHistoryPreferences('groups')).toEqual(grouped);
  invoke.mockResolvedValue({ ...grouped, groups: [{ id: 'bad', name: 'Bad', commandKeys: null }] });
  await expect(getHistoryPreferences('bad-groups')).rejects.toThrow('Invalid command history preferences');
  invoke.mockResolvedValue({ ...grouped, groupColors: { build: 3 } });
  await expect(getHistoryPreferences('bad-colors')).rejects.toThrow('Invalid command history preferences');
  invoke.mockResolvedValue({ ...grouped, historyOrder: [3] });
  await expect(getHistoryPreferences('bad-order')).rejects.toThrow('Invalid command history preferences');
});
