import { describe, it, expect } from 'vitest';
import { filterSessions, isSshSession, sshTargetOf } from '@features/session-history';
import { sessionTerminalModes } from '../model/filter';
import type { BackendSessionEntry } from '@platform/api/types';

const pane = (over: Record<string, unknown> = {}) => ({ type: 'leaf', terminal: { id: 'pane', kind: 'local', shellType: 'bash', openMode: 'block', ...over } });
const payload = (layout: unknown = pane()) => JSON.stringify({ layout });
const sshPane = (over: Record<string, unknown> = {}) => pane({ kind: 'ssh', openMode: 'classic', ssh: { host: 'prod.example.com', user: 'root' }, ...over });

function mk(over: Partial<BackendSessionEntry>): BackendSessionEntry {
  return {
    id: 's1',
    title: '终端',
    status: 'historical',
    created_at: 0,
    closed_at: Date.now(),
    block_count: 0,
    cwd: '',
    group_id: null,
    sort_order: 0,
    kind: 'local',
    payload: payload(),
    ...over,
  };
}

const HOUR = 3600 * 1000;

it('matches annotation text without bypassing type, date or starred filters', () => {
  const local = mk({ id: 'local' });
  const remote = mk({ id: 'remote', kind: 'ssh', payload: payload(sshPane()) });
  const annotations = new Map([['local', 'Servers'], ['remote', 'Servers']]);
  expect(filterSessions([local, remote], 'servers', 'ssh', 'all', 'all', 'closed', null, annotations).map(item => item.id)).toEqual(['remote']);
  expect(filterSessions([local, { ...remote, closed_at: 0 }], 'servers', 'ssh', 'today', 'all', 'closed', null, annotations)).toEqual([]);
  expect(filterSessions([remote], 'servers', 'ssh', 'all', 'all', 'closed', new Set(['local']), annotations)).toEqual([]);
});

it('filters current pane modes including mixed panes, SSH and cmd', () => {
  const block = mk({ id: 'block', payload: payload() });
  const classic = mk({ id: 'classic', payload: payload(pane({ openMode: 'classic' })) });
  const mixed = mk({ id: 'mixed', payload: payload({ type: 'split', first: pane({ openMode: 'block' }), second: pane({ openMode: 'classic', kind: 'ssh' }) }) });
  expect(filterSessions([block, classic, mixed], '', 'all', 'all', 'block')).toEqual([block, mixed]);
  expect(filterSessions([block, classic, mixed], '', 'all', 'all', 'classic')).toEqual([classic, mixed]);
  expect(sessionTerminalModes(mk({ payload: payload(sshPane()) }))).toEqual(new Set(['classic']));
  expect(sessionTerminalModes(mk({}))).toEqual(new Set(['block']));
  expect(sessionTerminalModes(mk({ payload: payload(pane({ shellType: 'cmd' })) }))).toEqual(new Set(['classic']));
});

describe('isSshSession / sshTargetOf', () => {
  it('reads the SSH pane identity from the current layout', () => {
    expect(isSshSession(mk({ kind: 'ssh' }))).toBe(true);
    expect(isSshSession(mk({ payload: payload(sshPane()) }))).toBe(true);
    expect(isSshSession(mk({}))).toBe(false);
  });

  it('解析 SSH 目标 user@host', () => {
    expect(sshTargetOf(mk({ payload: payload(sshPane()) }))).toBe('root@prod.example.com');
    expect(sshTargetOf(mk({ payload: payload(sshPane({ ssh: { host: 'h' } })) }))).toBe('h');
    expect(sshTargetOf(mk({}))).toBeNull();
  });
});

describe('filterSessions', () => {
  const ssh = mk({ id: 'ssh-1', title: '生产服务器', kind: 'ssh', payload: payload(sshPane()), closed_at: Date.now() });
  const local = mk({ id: 'local-1', title: 'Zsh', closed_at: Date.now() });
  const oldLocal = mk({ id: 'old-1', title: '老会话', closed_at: Date.now() - 40 * 24 * HOUR });
  const sessions = [ssh, local, oldLocal];

  it('无过滤时全部保留', () => {
    expect(filterSessions(sessions, '', 'all', 'all').length).toBe(3);
  });

  it('搜索匹配标题', () => {
    expect(filterSessions(sessions, '生产', 'all', 'all')).toEqual([ssh]);
    expect(filterSessions(sessions, 'zsh', 'all', 'all')).toEqual([local]);
  });

  it('搜索匹配 SSH 目标(user@host / host)', () => {
    expect(filterSessions(sessions, 'root@prod', 'all', 'all')).toEqual([ssh]);
    expect(filterSessions(sessions, 'prod.example', 'all', 'all')).toEqual([ssh]);
  });

  it('类型筛选:仅本地 / 仅 SSH', () => {
    expect(filterSessions(sessions, '', 'local', 'all')).toEqual([local, oldLocal]);
    expect(filterSessions(sessions, '', 'ssh', 'all')).toEqual([ssh]);
  });

  it('日期筛选:近 30 天排除 40 天前关闭的会话', () => {
    const in30 = filterSessions(sessions, '', 'all', '30d');
    expect(in30).toContain(ssh);
    expect(in30).toContain(local);
    expect(in30).not.toContain(oldLocal);
    expect(filterSessions(sessions, '', 'all', 'today')).toEqual([ssh, local]);
  });

  it('组合过滤:SSH + 近 30 天 + 关键字', () => {
    expect(filterSessions(sessions, 'prod', 'ssh', '30d')).toEqual([ssh]);
    // 关键字不匹配时为空
    expect(filterSessions(sessions, '不存在', 'ssh', '30d')).toEqual([]);
    // 类型冲突时为空
    expect(filterSessions(sessions, 'prod', 'local', '30d')).toEqual([]);
  });

  it('restricts to starred ids when a starred set is provided', () => {
    expect(filterSessions(sessions, '', 'all', 'all', 'all', 'closed', new Set(['local-1']))).toEqual([local]);
    expect(filterSessions(sessions, 'prod', 'ssh', '30d', 'all', 'closed', new Set(['local-1']))).toEqual([]);
    expect(filterSessions(sessions, '', 'all', 'all', 'all', 'closed', new Set())).toEqual([]);
  });
});

it('finds SSH hosts in restored pane layouts with formatted JSON', () => {
  const session = mk({ payload: JSON.stringify({ layout: { type: 'leaf', terminal: { kind: 'ssh', ssh: { host: 'saved.example', user: 'dev' } } } }, null, 2) });
  expect(isSshSession(session)).toBe(true);
  expect(sshTargetOf(session)).toBe('dev@saved.example');
  expect(filterSessions([session], 'saved.example', 'ssh', 'all')).toEqual([session]);
});
