import { describe, expect, it } from 'vitest';
import type { BackendSessionEntry } from '@platform/api/types';
import { deriveSessionHistorySections, hasSessionHistoryFilter } from '@features/session-history/model/sessionHistoryModel';

function session(overrides: Partial<BackendSessionEntry>): BackendSessionEntry {
  return {
    id: 'id', title: '标题', status: 'historical', kind: 'local', payload: '{}',
    cwd: '/workspace', created_at: 1, closed_at: Date.now(), block_count: 0, sort_order: 0,
    group_id: null, ...overrides,
  };
}

describe('session history model', () => {
  it('只展示历史会话并按分组和顺序组织', () => {
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

  it('正确判断过滤条件是否启用', () => {
    expect(hasSessionHistoryFilter({ query: 'ssh', type: 'all', date: 'all' })).toBe(false);
    expect(hasSessionHistoryFilter({ query: '', type: 'ssh', date: 'all' })).toBe(true);
  });
});
