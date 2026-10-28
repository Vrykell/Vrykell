import { describe, expect, it } from 'vitest';
import { t } from '@i18n';
import type { BackendSessionEntry } from '@platform/api/types';
import { deriveSessionHistorySections, groupHistoricalSessions, hasSessionHistoryFilter, sessionCommandCount, sessionSummaryText, sortHistoricalSessions, updateSessionHistoryFilter, type SessionHistorySort } from '@features/session-history/model/sessionHistoryModel';

const pane = (over: Record<string, unknown> = {}) => ({ type: 'leaf', terminal: { id: 'pane', kind: 'local', shellType: 'bash', openMode: 'block', ...over } });
const payload = (layout: unknown = pane()) => JSON.stringify({ layout });

function session(overrides: Partial<BackendSessionEntry>): BackendSessionEntry {
  return {
    id: 'id', title: '标题', status: 'historical', kind: 'local', payload: payload(),
    cwd: '/workspace', created_at: 1, closed_at: Date.now(), block_count: 0, sort_order: 0,
    group_id: null, ...overrides,
  };
}

describe('session history model', () => {
  it.each([
    ['closed-desc', ['a', 'b']], ['closed-asc', ['b', 'a']],
    ['created-desc', ['b', 'a']], ['created-asc', ['a', 'b']],
    ['title-asc', ['a', 'b']], ['title-desc', ['b', 'a']],
  ] as Array<[SessionHistorySort, string[]]>)('sorts %s without changing source data', (sort, expected) => {
    const items = [session({ id: 'a', title: 'Alpha', closed_at: 20, created_at: 1 }), session({ id: 'b', title: 'Beta', closed_at: 10, created_at: 2 })];
    expect(sortHistoricalSessions(items, sort).map(item => item.id)).toEqual(expected);
    expect(items.map(item => item.id)).toEqual(['a', 'b']);
  });
  it('keeps groups and sorts both grouped and loose results after mode filtering', () => {
    const items = ['g', null].flatMap(group_id => [
      session({ id: `b-${group_id}`, group_id, title: 'Beta', payload: payload(pane({ openMode: 'block' })) }),
      session({ id: `a-${group_id}`, group_id, title: 'Alpha', payload: payload(pane({ openMode: 'block' })) }),
      session({ id: `c-${group_id}`, group_id, payload: payload(pane({ openMode: 'classic' })) }),
    ]);
    const sections = deriveSessionHistorySections(items, { query: '', type: 'all', date: 'all', mode: 'block', sort: 'title-asc' });
    expect(sections.grouped.get('g')!.map(item => item.title)).toEqual(['Alpha', 'Beta']);
    expect(sections.ungrouped.map(item => item.title)).toEqual(['Alpha', 'Beta']);
    expect(hasSessionHistoryFilter({ query: '', type: 'all', date: 'all', mode: 'classic' })).toBe(true);
  });
  it('groups by the saved shell type independently of startup mode and workspace membership', () => {
    const items = [
      session({ id: 'bash', payload: payload(pane({ shellType: 'bash', openMode: 'classic' })), group_id: 'old-group' }),
      session({ id: 'cmd', payload: payload(pane({ shellType: 'cmd' })) }),
      session({ id: 'ssh', kind: 'ssh', payload: payload(pane({ kind: 'ssh', ssh: { host: 'example' } })) }),
    ];
    expect(groupHistoricalSessions(items, 'terminal').map(card => card.title)).toEqual(['Bash', 'CMD', 'SSH']);
    expect(new Set(groupHistoricalSessions(items, 'type').map(card => card.id))).toEqual(new Set(['type:local', 'type:ssh']));
  });
  it('reads remote pane directories and separates local paths, hosts, users and ports', () => {
    const remote = (id: string, host: string, user = 'dev', port = 22) => session({ id, cwd: '',
      payload: JSON.stringify({ layout: { type: 'leaf', terminal: { kind: 'ssh', cwd: '/srv/app', ssh: { host, user, port } } } }) });
    const items = [session({ id: 'local', cwd: '/srv/app' }), remote('a', 'a.test'), remote('b', 'b.test'), remote('root', 'a.test', 'root'), remote('port', 'a.test', 'dev', 2222)];
    const cards = groupHistoricalSessions(items, 'cwd');
    expect(cards).toHaveLength(5);
    expect(cards.map(card => card.title)).toContain('dev@a.test · /srv/app');
    expect(cards.map(card => card.title)).toContain('dev@a.test:2222 · /srv/app');
    expect(cards.every(card => card.sessions.length === 1)).toBe(true);
    const missing = groupHistoricalSessions([remote('a', 'a.test'), session({ id: 'missing', cwd: '', kind: 'ssh', payload: payload(pane({ kind: 'ssh', ssh: { host: 'b.test' } })) })], 'cwd');
    expect(missing.find(card => card.title.startsWith('b.test'))?.title).toContain('未记录工作目录');
  });
  it('counts mixed panes once and retains their group when connection or mode filters match a pane', () => {
    const leaf = (kind: string, cwd: string, shellType?: string) => ({ type: 'leaf', terminal: { kind, cwd, shellType } });
    const mixed = session({ id: 'mixed', payload: JSON.stringify({ layout: { type: 'split', first: leaf('local', '/local', 'bash'), second: leaf('ssh', '/remote') } }) });
    for (const type of ['local', 'ssh'] as const) {
      const { historical } = deriveSessionHistorySections([mixed], { query: '/remote', type, date: 'all' });
      expect(historical).toEqual([mixed]);
      expect(groupHistoricalSessions(historical, 'cwd')).toMatchObject([{ id: 'cwd:multiple', sessions: [{ id: 'mixed' }] }]);
      expect(groupHistoricalSessions(historical, 'terminal')).toMatchObject([{ id: 'terminal:mixed', sessions: [{ id: 'mixed' }] }]);
      expect(groupHistoricalSessions(historical, 'type')).toMatchObject([{ id: 'type:mixed', sessions: [{ id: 'mixed' }] }]);
    }
  });
  it('keeps category card order independent of record sorting', () => {
    const items = [session({ id: 'a', title: 'Zebra', cwd: '/a' }), session({ id: 'b', title: 'Alpha', cwd: '/b' }), session({ id: 'a2', title: 'Apple', cwd: '/a' })];
    for (const sort of ['title-asc', 'title-desc', 'closed-asc'] as const) {
      const cards = groupHistoricalSessions(items, 'cwd', sort);
      expect(cards.map(card => card.title)).toEqual(['/a', '/b']);
      if (sort.startsWith('title')) expect(cards[0].sessions.map(item => item.title)).toEqual(sort === 'title-asc' ? ['Apple', 'Zebra'] : ['Zebra', 'Apple']);
    }
  });
  it('uses creation time consistently for filtering and calendar grouping when creation sorting is selected', () => {
    const today = Date.now();
    const old = today - 40 * 86400000;
    const items = [session({ id: 'old-created', created_at: old, closed_at: today }), session({ id: 'new-created', created_at: today, closed_at: today })];
    const filter = { query: '', type: 'all', date: '7d' } as const;
    expect(deriveSessionHistorySections(items, { ...filter, sort: 'closed-desc' }).historical).toHaveLength(2);
    expect(deriveSessionHistorySections(items, { ...filter, sort: 'created-desc' }).historical.map(item => item.id)).toEqual(['new-created']);
    expect(groupHistoricalSessions(items, 'day', 'created-desc')).toHaveLength(2);
    expect(groupHistoricalSessions(items, 'day', 'closed-desc')).toHaveLength(1);
    expect(groupHistoricalSessions(items, 'day', 'created-asc')[0].sessions[0].id).toBe('old-created');
  });
  it('keeps calendar cards chronological when titles determine record order', () => {
    const old = new Date(2026, 0, 2).getTime();
    const newer = new Date(2026, 0, 3).getTime();
    const cards = groupHistoricalSessions([session({ title: 'Alpha', closed_at: old }), session({ title: 'Zebra', closed_at: newer })], 'day', 'title-asc');
    expect(cards[0].sessions[0].title).toBe('Zebra');
  });
  it('retains the date basis for title sorting and grouping changes', () => {
    const created = updateSessionHistoryFilter({ query: 'server', type: 'ssh', date: '7d', groupBy: 'day' }, { sort: 'created-asc' });
    const title = updateSessionHistoryFilter(created, { sort: 'title-desc', groupBy: 'terminal' });
    expect(title).toMatchObject({ query: 'server', type: 'ssh', date: '7d', dateField: 'created', sort: 'title-desc', groupBy: 'terminal' });
    expect(updateSessionHistoryFilter(created, { dateField: 'closed' })).toMatchObject({ sort: 'closed-asc', dateField: 'closed' });
  });
  it('shows only historical sessions and organizes them by group and order', () => {
    const result = deriveSessionHistorySections([
      session({ id: 'active', status: 'active' }),
      session({ id: 'b', group_id: 'g1', sort_order: 2 }),
      session({ id: 'a', group_id: 'g1', sort_order: 1 }),
      session({ id: 'free', group_id: null }),
    ], { query: '', type: 'all', date: 'all' });

    expect(result.historical.map((item) => item.id)).toEqual(['b', 'a', 'free']);
    expect(result.grouped.get('g1')?.map((item) => item.id)).toEqual(['a', 'b']);
    expect(result.ungrouped.map((item) => item.id)).toEqual(['free']);
  });

  it('detects whether a filter is active', () => {
    expect(hasSessionHistoryFilter({ query: 'ssh', type: 'all', date: 'all' })).toBe(false);
    expect(hasSessionHistoryFilter({ query: '', type: 'ssh', date: 'all' })).toBe(true);
  });

  it('treats starred-only as an active filter and applies the starred set', () => {
    const items = [session({ id: 'starred' }), session({ id: 'plain' })];
    const sections = deriveSessionHistorySections(items, { query: '', type: 'all', date: 'all', starredOnly: true }, new Set(['starred']));
    expect(sections.historical.map(item => item.id)).toEqual(['starred']);
    expect(hasSessionHistoryFilter({ query: '', type: 'all', date: 'all', starredOnly: true })).toBe(true);
    expect(deriveSessionHistorySections(items, { query: '', type: 'all', date: 'all' }, new Set(['starred'])).historical).toHaveLength(2);
  });

  it('keeps pinned groups first without changing the order inside each half', () => {
    const items = ['/a', '/b', '/c'].map((cwd, index) => session({ id: `s${index}`, cwd }));
    const pinned = groupHistoricalSessions(items, 'cwd', 'closed-desc', 'closed', new Set(['cwd:/c']));
    expect(pinned.map(card => card.id)).toEqual(['cwd:/c', 'cwd:/a', 'cwd:/b']);
    expect(pinned[0].sessions).toHaveLength(1);
    const plain = groupHistoricalSessions(items, 'cwd', 'closed-desc', 'closed', null);
    expect(plain.map(card => card.id)).toEqual(['cwd:/a', 'cwd:/b', 'cwd:/c']);
  });
});

it('shows command counts only for block sessions, including mixed layouts', () => {
  const metadata = (mode: 'classic' | 'block') => pane({ openMode: mode });
  expect(sessionCommandCount(session({ block_count: 4, payload: payload(metadata('classic')) }))).toBeNull();
  expect(sessionCommandCount(session({ block_count: 0, payload: payload(metadata('block')) }))).toBe(0);
  expect(sessionCommandCount(session({ block_count: 2, payload: payload({ type: 'split', first: metadata('classic'), second: metadata('block') }) }))).toBe(2);
  expect(sessionCommandCount(session({ kind: 'ssh', block_count: 0, payload: payload(pane({ kind: 'ssh', openMode: 'classic', ssh: { host: 'remote.test' } })) }))).toBeNull();
  expect(sessionCommandCount(session({ block_count: 3, payload: '{}' }))).toBe(3);
});

it('summarizes a session for the clipboard', () => {
  const item = session({
    id: 'deploy', title: 'Deploy production', kind: 'ssh',
    payload: JSON.stringify({ layout: { type: 'leaf', terminal: { kind: 'ssh', cwd: '/srv/app', openMode: 'block', ssh: { host: 'prod.test', user: 'root' } } } }),
    created_at: Date.UTC(2026, 9, 1, 8, 0), closed_at: Date.UTC(2026, 9, 1, 9, 30), block_count: 4,
  });
  const text = sessionSummaryText(item);
  expect(text.split('\n')[0]).toBe('Deploy production');
  expect(text).toContain('Type: SSH');
  expect(text).toContain('Target: root@prod.test');
  expect(text).toContain('Directories: root@prod.test · /srv/app');
  expect(text).toContain('Command blocks: 4');
  expect(sessionSummaryText(session({ id: 'plain', title: '' }))).toContain(t('Untitled session'));
});
