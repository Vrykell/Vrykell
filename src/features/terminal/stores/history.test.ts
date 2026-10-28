/**
 * history — command history hot-cache store (record/search/clear/hydrate).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { useHistoryStore } from '@features/terminal/stores/history';

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(() => Promise.reject(new Error('no backend')));
  useHistoryStore.setState({ entries: [] });
});

describe('history store', () => {
  it('record: deduplicates, moves to the top and persists', () => {
    const s = useHistoryStore.getState();
    s.record('ls', '/a', 0);
    s.record('pwd', '/b', null);
    s.record('ls', '/a', 1); // A repeated command is deduplicated and moved to the top
    const entries = useHistoryStore.getState().entries;
    expect(entries.map((e) => e.command)).toEqual(['ls', 'pwd']);
    expect(entries[0]!.exitCode).toBe(1);
    expect(invokeMock).toHaveBeenCalledWith('record_history', expect.objectContaining({
      command: 'ls', cwd: '/a', exitCode: 1,
    }));
  });

  it('search: prefix matching, case insensitive, limit truncation', () => {
    const s = useHistoryStore.getState();
    s.record('npm run dev', '/a', 0);
    s.record('npm test', '/b', 0);
    s.record('echo hi', '/c', 0);
    expect(useHistoryStore.getState().search('NPM').map((e) => e.command)).toEqual(['npm test', 'npm run dev']);
    expect(useHistoryStore.getState().search('npm', 1)).toHaveLength(1);
    expect(useHistoryStore.getState().search('zzz')).toEqual([]);
  });

  it('clear: clears local state and the backend', () => {
    const s = useHistoryStore.getState();
    s.record('ls', '/a', 0);
    s.clear();
    expect(useHistoryStore.getState().entries).toEqual([]);
    expect(invokeMock).toHaveBeenCalledWith('clear_history');
  });

  it('hydrate: deduplicates on refill, prefers new in-session records and stays silent on failure', async () => {
    const s = useHistoryStore.getState();
    s.record('fresh', '/a', 0);
    invokeMock.mockResolvedValueOnce([
      { command: 'old1', cwd: '/x', timestamp: 1, exit_code: 0 },
      { command: 'old1', cwd: '/x', timestamp: 2, exit_code: 0 }, // duplicate
      { command: 'fresh', cwd: '/a', timestamp: 3, exit_code: 0 }, // duplicates a local record → skipped
    ]);
    await useHistoryStore.getState().hydrate();
    const entries = useHistoryStore.getState().entries;
    expect(entries.map((e) => e.command)).toEqual(['fresh', 'old1']);
    expect(invokeMock).toHaveBeenCalledWith('search_history', { query: '', maxResults: 200, filterExitCode: null, since: null, cwd: null });
    // Backend failure is silent
    useHistoryStore.setState({ entries: [{ command: 'keep', cwd: '/a', timestamp: 0, exitCode: null }] });
    await useHistoryStore.getState().hydrate();
    expect(useHistoryStore.getState().entries[0]!.command).toBe('keep');
  });
});
