import { describe, expect, it } from 'vitest';
import type { BackendSessionEntry } from '@platform/api/types';
import { DEFAULT_UNIFIED_FILTER, filterUnifiedHistory, groupUnifiedHistory, unifiedHistoryRecords } from '../model/unifiedHistory';

const session = (id: string, kind: 'local' | 'ssh', time: number): BackendSessionEntry => ({
  id, title: `${kind} ${id}`, status: 'historical', created_at: time - 100, closed_at: time,
  block_count: 0, cwd: kind === 'local' ? '/repo' : '', group_id: null, sort_order: 0, kind,
  payload: JSON.stringify({ layout: { type: 'leaf', terminal: kind === 'ssh'
    ? { id: `${id}#0`, kind, ssh: { host: 'prod.example.com', user: 'deploy' }, openMode: 'classic' }
    : { id: `${id}#0`, kind, cwd: '/repo', openMode: 'block' } } }),
});

it('matches every member type of a mixed combination without splitting the history record', () => {
  const mixed = { ...session('workspace:test', 'local', 100), kind: 'workspace', payload: JSON.stringify({ version: 1, focused: 'one',
    layout: { type: 'split', direction: 'row', ratio: 0.5, first: { type: 'pane', id: 'one', resourceId: 'terminal:one' }, second: { type: 'pane', id: 'two', resourceId: 'chat:two' } },
    members: [{ id: 'terminal:one', title: 'Shell', reference: 'one', kind: 'terminal', local: true, ssh: false, paneCount: 1 },
      { id: 'chat:two', title: 'Chat', reference: 'two', kind: 'conversation', local: false, ssh: false, paneCount: 1 }] }) };
  const records = unifiedHistoryRecords([mixed, session('single', 'local', 90)], [], { notes: {}, starred: {} });
  for (const type of ['terminal', 'conversation'] as const) {
    const visible = filterUnifiedHistory(records, { ...DEFAULT_UNIFIED_FILTER, type, layout: 'split' });
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({ kind: 'workspace', paneCount: 2, types: ['terminal', 'conversation'] });
  }
  expect(filterUnifiedHistory(records, { ...DEFAULT_UNIFIED_FILTER, layout: 'single' }).map(record => record.kind)).toEqual(['terminal']);
});

it('hides old file-only groups and excludes file members from mixed session history', () => {
  const file = { id: 'file:draft', title: 'Untitled.txt', reference: 'Untitled.txt', kind: 'document', local: true, ssh: false, paneCount: 1 };
  const chat = { id: 'chat:chat', title: 'Discussion', reference: 'chat', kind: 'conversation', local: false, ssh: false, paneCount: 1 };
  const first = { type: 'pane', id: 'file', resourceId: file.id };
  const second = { type: 'pane', id: 'chat', resourceId: chat.id };
  const onlyFiles = { ...session('workspace:file', 'local', 200), kind: 'workspace', payload: JSON.stringify({ version: 1, focused: 'file', layout: first, members: [file] }) };
  const mixed = { ...session('workspace:mixed', 'local', 201), kind: 'workspace', payload: JSON.stringify({ version: 1, focused: 'file',
    layout: { type: 'split', direction: 'row', ratio: 0.5, first, second }, members: [file, chat] }) };
  const records = unifiedHistoryRecords([onlyFiles, mixed], [], { notes: {}, starred: {} });
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ title: 'Discussion', paneCount: 1, snapshot: { focused: 'chat', members: [chat] } });
  expect(records[0]!.searchText).not.toContain('untitled');
});

it('recovers profile icons for old composition metadata from the matching parent pane', () => {
  const parent = { ...session('owner', 'local', 100), payload: JSON.stringify({ layout: { type: 'split',
    first: { type: 'leaf', terminal: { id: 'one', kind: 'local', shellType: 'powershell' } },
    second: { type: 'leaf', terminal: { id: 'two', kind: 'local', shellType: 'bash' } } } }) };
  const mixed = { ...session('workspace:test', 'local', 200), kind: 'workspace', payload: JSON.stringify({ version: 1, focused: 'one',
    layout: { type: 'split', direction: 'row', ratio: 0.5, first: { type: 'pane', id: 'one', resourceId: 'terminal:two' }, second: { type: 'pane', id: 'chat', resourceId: 'chat:chat' } },
    members: [{ id: 'terminal:two', title: 'Shell', reference: 'owner', paneId: 'two', kind: 'terminal', local: true, ssh: false, paneCount: 1 },
      { id: 'chat:chat', title: 'Chat', reference: 'chat', kind: 'conversation', local: false, ssh: false, paneCount: 1 }] }) };
  const record = unifiedHistoryRecords([mixed, parent], [], { notes: {}, starred: {} })[0]!;
  expect(record.kind === 'workspace' && record.snapshot.members[0]?.shellType).toBe('bash');
});

describe('unified history', () => {
  it('keeps agent-owned references distinct from native conversations and terminal sessions', () => {
    const records = unifiedHistoryRecords([], [], { notes: {}, starred: {} }, [{ harness: 'Agent', sessionId: 'external', cwd: '/agent', at: 1000 }]);
    expect(records[0]).toMatchObject({ kind: 'agent', terminalType: 'ACP', title: 'Agent', cwd: '/agent' });
    expect(filterUnifiedHistory(records, { ...DEFAULT_UNIFIED_FILTER, type: 'conversation', query: 'ACP' })).toHaveLength(1);
    expect(filterUnifiedHistory(records, { ...DEFAULT_UNIFIED_FILTER, type: 'terminal' })).toHaveLength(0);
    expect(groupUnifiedHistory(records, 'terminal', new Set(), { groupTitles: {}, groupNotes: {}, collapsedGroups: {} })[0]?.title).toBe('ACP 会话');
  });
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
