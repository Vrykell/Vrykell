import { beforeEach, describe, expect, it } from 'vitest';
import {
  HISTORY_META_STORAGE_KEY,
  historyGroupKey,
  historyRecordKey,
  historySearchAnnotations,
  scopedGroupIds,
  scopedIds,
  useHistoryMetaStore,
} from '../historyMeta';

const resetStore = () => {
  useHistoryMetaStore.setState(useHistoryMetaStore.getInitialState(), true);
};

beforeEach(() => {
  localStorage.clear();
  resetStore();
});

describe('historyMeta key helpers', () => {
  it('searches record notes and current-mode group annotations without leaking another history scope', () => {
    const state = useHistoryMetaStore.getState();
    state.setGroupTitle(historyGroupKey('session', 'cwd', 'cwd:/work'), 'Servers');
    state.setGroupNote(historyGroupKey('session', 'cwd', 'cwd:/work'), 'Deployment');
    state.setNote('session:a', 'Follow up');
    const groups = [{ id: 'cwd:/work', title: '/work', recordIds: ['a', 'b'] }];
    const matches = historySearchAnnotations('session', 'cwd', groups, useHistoryMetaStore.getState());
    expect(matches.get('a')).toBe('/work Servers Deployment Follow up');
    expect(matches.get('b')).toBe('/work Servers Deployment');
    expect(historySearchAnnotations('conversation', 'cwd', groups, useHistoryMetaStore.getState()).get('a')).toBe('/work');
  });

  it('namespaces record and group keys per scope', () => {
    expect(historyRecordKey('session', 'a')).toBe('session:a');
    expect(historyRecordKey('conversation', 'a')).toBe('conversation:a');
    expect(historyGroupKey('session', 'cwd', 'cwd:/srv')).toBe('session/cwd/cwd:/srv');
  });

  it('collects plain record ids of one scope', () => {
    const ids = scopedIds({ 'session:a': true, 'conversation:b': true, 'session:c': true }, 'session');
    expect([...ids].sort()).toEqual(['a', 'c']);
  });

  it('collects pinned group ids of one scope and grouping mode', () => {
    const pinned = {
      [historyGroupKey('session', 'day', 'day:2026-9-14')]: true,
      [historyGroupKey('session', 'cwd', 'cwd:/srv')]: true,
      [historyGroupKey('conversation', 'day', 'day:2026-9-14')]: true,
    } as Record<string, true>;
    expect([...scopedGroupIds(pinned, 'session', 'day')]).toEqual(['day:2026-9-14']);
    expect([...scopedGroupIds(pinned, 'session', 'cwd')]).toEqual(['cwd:/srv']);
    expect(scopedGroupIds(pinned, 'session', 'month').size).toBe(0);
  });
});

describe('historyMeta store', () => {
  it('keeps locks on records across grouping modes and batches stars without changing other scopes', () => {
    const state = useHistoryMetaStore.getState();
    state.setLocked(['session:a', 'session:b'], true);
    state.setStarred(['session:a', 'conversation:a'], true);
    state.setLocked(['session:b'], false);
    state.setStarred(['session:a'], false);
    expect(useHistoryMetaStore.getState().lockedRecords).toEqual({ 'session:a': true });
    expect(useHistoryMetaStore.getState().starred).toEqual({ 'conversation:a': true });
  });

  it('persists group names, notes and collapse state independently per grouping mode', async () => {
    const day = historyGroupKey('session', 'day', 'day:1');
    const directory = historyGroupKey('session', 'cwd', 'cwd:/work');
    const state = useHistoryMetaStore.getState();
    state.setGroupTitle(day, '  Investigation  ');
    state.setGroupNote(day, '  Follow up  ');
    state.setGroupsCollapsed([day, directory], true);
    state.setGroupsCollapsed([directory], false);
    await useHistoryMetaStore.persist.rehydrate();
    expect(useHistoryMetaStore.getState().groupTitles[day]).toBe('Investigation');
    expect(useHistoryMetaStore.getState().groupNotes[day]).toBe('Follow up');
    expect(useHistoryMetaStore.getState().collapsedGroups).toEqual({ [day]: true });
    state.setGroupTitle(day, '');
    expect(useHistoryMetaStore.getState().groupTitles[day]).toBeUndefined();
  });

  it('cleans only successfully deleted record annotations and preserves group preferences', () => {
    const state = useHistoryMetaStore.getState();
    state.setStarred(['session:a', 'session:b'], true);
    state.setLocked(['session:a', 'session:b'], true);
    state.setNote('session:a', 'note');
    state.setGroupTitle('session/day/day:1', 'Named');
    state.removeRecords(['session:a']);
    expect(useHistoryMetaStore.getState().starred).toEqual({ 'session:b': true });
    expect(useHistoryMetaStore.getState().lockedRecords).toEqual({ 'session:b': true });
    expect(useHistoryMetaStore.getState().notes).toEqual({});
    expect(useHistoryMetaStore.getState().groupTitles['session/day/day:1']).toBe('Named');
  });

  it('toggles stars and persists them under the shared key', () => {
    useHistoryMetaStore.getState().toggleStar('session:a');
    expect(useHistoryMetaStore.getState().starred['session:a']).toBe(true);
    const saved = JSON.parse(localStorage.getItem(HISTORY_META_STORAGE_KEY)!);
    expect(saved.state.starred).toEqual({ 'session:a': true });

    useHistoryMetaStore.getState().toggleStar('session:a');
    expect(useHistoryMetaStore.getState().starred['session:a']).toBeUndefined();
  });

  it('stores trimmed notes and removes empty ones', () => {
    useHistoryMetaStore.getState().setNote('conversation:x', '  deploy notes  ');
    expect(useHistoryMetaStore.getState().notes['conversation:x']).toBe('deploy notes');

    useHistoryMetaStore.getState().setNote('conversation:x', '   ');
    expect(useHistoryMetaStore.getState().notes['conversation:x']).toBeUndefined();
  });

  it('toggles pinned groups and group colors independently', () => {
    const key = historyGroupKey('session', 'day', 'day:2026-9-14');
    useHistoryMetaStore.getState().togglePinnedGroup(key);
    useHistoryMetaStore.getState().setGroupColor(key, 'cyan');
    expect(useHistoryMetaStore.getState().pinnedGroups[key]).toBe(true);
    expect(useHistoryMetaStore.getState().groupColors[key]).toBe('cyan');

    useHistoryMetaStore.getState().setGroupColor(key, null);
    expect(useHistoryMetaStore.getState().groupColors[key]).toBeUndefined();
  });

  it('rehydrates valid persisted values', async () => {
    const key = historyGroupKey('session', 'type', 'type:ssh');
    localStorage.setItem(HISTORY_META_STORAGE_KEY, JSON.stringify({
      version: 1,
      state: { starred: { 'session:a': true }, notes: { 'session:a': 'note' }, pinnedGroups: { [key]: true }, groupColors: { [key]: 'rose' } },
    }));
    await useHistoryMetaStore.persist.rehydrate();
    expect(useHistoryMetaStore.getState().starred['session:a']).toBe(true);
    expect(useHistoryMetaStore.getState().notes['session:a']).toBe('note');
    expect(useHistoryMetaStore.getState().pinnedGroups[key]).toBe(true);
    expect(useHistoryMetaStore.getState().groupColors[key]).toBe('rose');
  });

  it('degrades corrupt payloads to an empty annotation set', async () => {
    localStorage.setItem(HISTORY_META_STORAGE_KEY, JSON.stringify({
      version: 1,
      state: { starred: 'nope', notes: 5, pinnedGroups: [1, 2], groupColors: { good: 'blue', bad: 3 } },
    }));
    await useHistoryMetaStore.persist.rehydrate();
    expect(useHistoryMetaStore.getState().starred).toEqual({});
    expect(useHistoryMetaStore.getState().notes).toEqual({});
    expect(useHistoryMetaStore.getState().pinnedGroups).toEqual({});
    expect(useHistoryMetaStore.getState().groupColors).toEqual({ good: 'blue' });
  });

  it('survives an unreadable payload', async () => {
    localStorage.setItem(HISTORY_META_STORAGE_KEY, 'not-json');
    await useHistoryMetaStore.persist.rehydrate();
    expect(useHistoryMetaStore.getState().starred).toEqual({});
  });
});
