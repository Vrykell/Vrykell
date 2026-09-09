/**
 * history — 命令历史热缓存 store（record/search/clear/hydrate）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { useHistoryStore } from './history';

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(() => Promise.reject(new Error('no backend')));
  useHistoryStore.setState({ entries: [] });
});

describe('history store', () => {
  it('record：去重置顶 + 落库', () => {
    const s = useHistoryStore.getState();
    s.record('ls', '/a', 0);
    s.record('pwd', '/b', null);
    s.record('ls', '/a', 1); // 重复命令去重并置顶
    const entries = useHistoryStore.getState().entries;
    expect(entries.map((e) => e.command)).toEqual(['ls', 'pwd']);
    expect(entries[0]!.exitCode).toBe(1);
    expect(invokeMock).toHaveBeenCalledWith('record_history', expect.objectContaining({
      command: 'ls', cwd: '/a', exitCode: 1,
    }));
  });

  it('search：前缀匹配、大小写不敏感、limit 截断', () => {
    const s = useHistoryStore.getState();
    s.record('npm run dev', '/a', 0);
    s.record('npm test', '/b', 0);
    s.record('echo hi', '/c', 0);
    expect(useHistoryStore.getState().search('NPM').map((e) => e.command)).toEqual(['npm test', 'npm run dev']);
    expect(useHistoryStore.getState().search('npm', 1)).toHaveLength(1);
    expect(useHistoryStore.getState().search('zzz')).toEqual([]);
  });

  it('clear：清空本地与后端', () => {
    const s = useHistoryStore.getState();
    s.record('ls', '/a', 0);
    s.clear();
    expect(useHistoryStore.getState().entries).toEqual([]);
    expect(invokeMock).toHaveBeenCalledWith('clear_history');
  });

  it('hydrate：去重回填、会话内新记录优先；失败静默', async () => {
    const s = useHistoryStore.getState();
    s.record('fresh', '/a', 0);
    invokeMock.mockResolvedValueOnce([
      { command: 'old1', cwd: '/x', timestamp: 1, exit_code: 0 },
      { command: 'old1', cwd: '/x', timestamp: 2, exit_code: 0 }, // 重复
      { command: 'fresh', cwd: '/a', timestamp: 3, exit_code: 0 }, // 与本地重复 → 跳过
    ]);
    await useHistoryStore.getState().hydrate();
    const entries = useHistoryStore.getState().entries;
    expect(entries.map((e) => e.command)).toEqual(['fresh', 'old1']);
    expect(invokeMock).toHaveBeenCalledWith('search_history', { query: '', maxResults: 200, filterExitCode: null, since: null, cwd: null });
    // 后端失败静默
    useHistoryStore.setState({ entries: [{ command: 'keep', cwd: '/a', timestamp: 0, exitCode: null }] });
    await useHistoryStore.getState().hydrate();
    expect(useHistoryStore.getState().entries[0]!.command).toBe('keep');
  });
});
