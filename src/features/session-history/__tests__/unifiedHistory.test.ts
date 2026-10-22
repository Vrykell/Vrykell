import { describe, expect, it } from 'vitest';
import type { BackendSessionEntry } from '@platform/api/types';
import { DEFAULT_UNIFIED_FILTER, filterUnifiedHistory, groupUnifiedHistory, unifiedHistoryRecords } from '../model/unifiedHistory';

const session = (id: string, kind: 'local' | 'ssh', time: number): BackendSessionEntry => ({
  id, title: `${kind} ${id}`, status: 'historical', created_at: time - 100, closed_at: time,
  block_count: 0, cwd: kind === 'local' ? '/repo' : '', group_id: null, sort_order: 0, kind,
  payload: kind === 'ssh' ? JSON.stringify({ ssh: { host: 'prod.example.com', user: 'deploy' } }) : JSON.stringify({ cwd: '/repo' }),
});

describe('unified history', () => {
  it('merges terminal and AI records chronologically and keeps both search sources', () => {
    const records = unifiedHistoryRecords([session('local', 'local', 1000), session('remote', 'ssh', 3000)], [{
      id: 'chat', title: 'Explain deploy', createdAt: 500, updatedAt: 4000, environment: null,
    }], { notes: { 'session:local': 'notes' }, starred: {} });
    expect(records.map(record => record.key)).toEqual(['conversation:chat', 'session:remote', 'session:local']);
    expect(filterUnifiedHistory(records, { ...DEFAULT_UNIFIED_FILTER, query: 'deploy' })).toHaveLength(2);
    expect(filterUnifiedHistory(records, { ...DEFAULT_UNIFIED_FILTER, type: 'terminal' })).toHaveLength(2);
    expect(filterUnifiedHistory(records, { ...DEFAULT_UNIFIED_FILTER, query: 'notes' })[0]?.key).toBe('session:local');
  });

  it('filters dates and starred records without mutating source order', () => {
    const now = new Date(2026, 9, 22, 12).getTime();
    const records = unifiedHistoryRecords([session('old', 'local', now - 10 * 86400000), session('new', 'ssh', now)], [{
      id: 'chat', title: 'Pinned', createdAt: now - 100, updatedAt: now - 10, environment: null,
    }], { notes: {}, starred: { 'conversation:chat': true } });
    expect(filterUnifiedHistory(records, { ...DEFAULT_UNIFIED_FILTER, date: '7d' }, now).map(item => item.key)).toEqual(['session:new', 'conversation:chat']);
    expect(filterUnifiedHistory(records, { ...DEFAULT_UNIFIED_FILTER, starredOnly: true }, now).map(item => item.key)).toEqual(['conversation:chat']);
    expect(records.map(item => item.key)).toEqual(['session:new', 'conversation:chat', 'session:old']);
  });

  it('applies title and activity sorting after mixed record filtering', () => {
    const records = unifiedHistoryRecords([session('a', 'local', 1000), session('z', 'ssh', 5000)], [{
      id: 'chat', title: 'Middle', createdAt: 2000, updatedAt: 3000, environment: null,
    }], { notes: {}, starred: {} });
    const titleSorted = filterUnifiedHistory(records, { ...DEFAULT_UNIFIED_FILTER, sort: 'title-asc' });
    expect(titleSorted.map(record => record.title)).toEqual(['local a', 'Middle', 'ssh z']);
    const activitySorted = filterUnifiedHistory(records, { ...DEFAULT_UNIFIED_FILTER, sort: 'activity-desc' });
    expect(activitySorted.map(record => record.title)).toEqual(['ssh z', 'Middle', 'local a']);
  });

  it('groups mixed records by working directory and keeps pinned groups first', () => {
    const records = unifiedHistoryRecords([session('local', 'local', 1000), session('remote', 'ssh', 3000)], [{
      id: 'chat', title: 'Explain deploy', createdAt: 2000, updatedAt: 2500, environment: {
        paneId: 'pane', label: 'Discussion', kind: 'local', cwd: '/chat',
      },
    }], { notes: {}, starred: {} });
    const groups = groupUnifiedHistory(records, 'cwd', new Set(['local::/repo']), {
      groupTitles: {}, groupNotes: {}, collapsedGroups: {},
    });
    expect(groups.map(group => group.title)).toEqual(['/repo', '/chat', 'deploy@prod.example.com · 无工作目录']);
    expect(groups[0]?.records).toHaveLength(1);
  });
});
