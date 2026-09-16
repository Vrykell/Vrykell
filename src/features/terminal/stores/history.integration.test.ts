import { describe, it, expect, beforeEach } from 'vitest';
import { useHistoryStore } from '@features/terminal/stores/history';

describe('history store', () => {
  beforeEach(() => {
    useHistoryStore.getState().clear();
  });

  it('records and searches commands', () => {
    useHistoryStore.getState().record('npm install', '/project', 0);
    useHistoryStore.getState().record('git status', '/project', 0);
    useHistoryStore.getState().record('npm test', '/project', 2);

    const results = useHistoryStore.getState().search('npm');
    expect(results).toHaveLength(2);
    expect(results[0]!.command).toBe('npm test'); // 倒序，最新在前
    expect(results[1]!.command).toBe('npm install');
  });

  it('search is case-insensitive', () => {
    useHistoryStore.getState().record('Echo Hello', '/', 0);
    const results = useHistoryStore.getState().search('echo');
    expect(results).toHaveLength(1);
  });

  it('deduplicates by command text (keeps latest)', () => {
    useHistoryStore.getState().record('ls', '/a', 0);
    useHistoryStore.getState().record('ls', '/b', 1);

    const entries = useHistoryStore.getState().search('ls');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.exitCode).toBe(1); // 最新的
  });

  it('limits search results', () => {
    for (let i = 0; i < 10; i++) {
      useHistoryStore.getState().record(`cmd-${i}`, '/', 0);
    }
    const results = useHistoryStore.getState().search('cmd', 3);
    expect(results).toHaveLength(3);
  });

  it('clear removes all entries', () => {
    useHistoryStore.getState().record('test', '/', 0);
    useHistoryStore.getState().clear();
    expect(useHistoryStore.getState().entries).toHaveLength(0);
  });

  it('历史单一权威在后端：不再写 localStorage', () => {
    useHistoryStore.getState().record('deploy', '/', 0);
    expect(localStorage.getItem('vrykell-cmd-history')).toBeNull();
  });
});
