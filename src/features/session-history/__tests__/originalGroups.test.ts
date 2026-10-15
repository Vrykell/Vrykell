import { expect, it } from 'vitest';
import type { BackendGroupEntry, BackendSessionEntry } from '@platform/api/types';
import { groupHistoricalSessions } from '../model/sessionHistoryModel';

const group: BackendGroupEntry = { id: 'project', title: 'Project', collapsed: false, archived: true,
  session_count: 0, sort_order: 0, created_at: 1 };
const member = (id: string, cwd: string, closed: number): BackendSessionEntry => ({ id, title: id, cwd,
  created_at: 1, closed_at: closed, status: 'historical', group_id: group.id, sort_order: 0,
  kind: 'local', payload: '{}', block_count: 0 });

it('preserves original groups across directory and date classifications without duplicating members', () => {
  const now = Date.now();
  const sessions = [member('one', '/a', now), member('two', '/b', now - 10 * 86400000),
    { ...member('loose', '/a', now), group_id: null }];
  for (const groupBy of ['cwd', 'day', 'week', 'month', 'terminal', 'type', 'none'] as const) {
    const cards = groupHistoricalSessions(sessions, groupBy, 'closed-desc', 'closed', null, { groups: [group], sessions });
    const original = cards.find(card => card.originalGroup);
    expect(original).toMatchObject({ id: 'source:project', title: 'Project', totalCount: 2 });
    expect(original!.sessions.map(item => item.id)).toEqual(['one', 'two']);
    expect(cards.flatMap(card => card.sessions).map(item => item.id).sort()).toEqual(['loose', 'one', 'two']);
    if (groupBy === 'cwd') expect(original!.categoryTitle).toBe('多个工作目录');
  }
});

it('keeps classification and total membership stable when filtering while sorting only matching rows', () => {
  const sessions = [member('Alpha', '/a', 10), member('Zebra', '/b', 20)];
  const source = { groups: [group], sessions };
  const all = groupHistoricalSessions(sessions, 'cwd', 'title-desc', 'closed', null, source)[0];
  const filtered = groupHistoricalSessions(sessions.slice(0, 1), 'cwd', 'title-desc', 'closed', null, source)[0];
  expect(all.sessions.map(item => item.id)).toEqual(['Zebra', 'Alpha']);
  expect(filtered).toMatchObject({ id: all.id, categoryTitle: all.categoryTitle, timestamp: all.timestamp, totalCount: 2 });
  expect(filtered.sessions.map(item => item.id)).toEqual(['Alpha']);
});

it('keeps original group pin identities across classification changes and falls back safely for missing containers', () => {
  const sessions = [member('one', '/z', 10), { ...member('loose', '/a', 20), group_id: null }];
  const pinned = new Set(['source:project']);
  const source = { groups: [group], sessions };
  expect(groupHistoricalSessions(sessions, 'cwd', 'closed-desc', 'closed', pinned, source)[0].id).toBe('source:project');
  expect(groupHistoricalSessions(sessions, 'day', 'closed-desc', 'closed', pinned, source)[0].id).toBe('source:project');
  expect(groupHistoricalSessions(sessions, 'none', 'closed-desc', 'closed', null, { groups: [], sessions })[0].sessions).toHaveLength(2);
});
