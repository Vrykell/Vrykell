import { describe, it, expect } from 'vitest';
import { filterSessions, isSshSession, sshTargetOf } from '@features/session-history';
import { sessionTerminalModes } from '../model/filter';
import type { BackendSessionEntry } from '@platform/api/types';

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
    payload: '{}',
    ...over,
  };
}

const HOUR = 3600 * 1000;

it('filters saved startup modes including mixed panes, SSH, cmd and legacy defaults', () => {
  const pane = (openMode: string, kind = 'local', shellType = 'bash') => ({ type: 'leaf', terminal: { openMode, kind, shellType } });
  const block = mk({ id: 'block', payload: JSON.stringify({ layout: pane('block') }) });
  const classic = mk({ id: 'classic', payload: JSON.stringify({ openMode: 'classic' }) });
  const mixed = mk({ id: 'mixed', payload: JSON.stringify({ layout: { type: 'split', first: pane('block'), second: pane('classic', 'ssh') } }) });
  expect(filterSessions([block, classic, mixed], '', 'all', 'all', 'block')).toEqual([block, mixed]);
  expect(filterSessions([block, classic, mixed], '', 'all', 'all', 'classic')).toEqual([classic, mixed]);
  expect(sessionTerminalModes(mk({ kind: 'ssh' }))).toEqual(new Set(['classic']));
  expect(sessionTerminalModes(mk({}))).toEqual(new Set(['block']));
  expect(sessionTerminalModes(mk({ payload: JSON.stringify({ layout: pane('block', 'local', 'cmd') }) }))).toEqual(new Set(['classic']));
  expect(sessionTerminalModes(mk({ kind: 'ssh', payload: JSON.stringify({ openMode: 'block' }) }))).toEqual(new Set(['block']));
});

describe('isSshSession / sshTargetOf', () => {
  it('识别 kind=ssh 与 payload 中的 ssh 标记', () => {
    expect(isSshSession(mk({ kind: 'ssh' }))).toBe(true);
    // 布局 payload 里的 kind 标记（kind 字段缺失时兜底识别）
    expect(isSshSession(mk({ kind: 'local', payload: '{"kind":"ssh","ssh":{"host":"h"}}' }))).toBe(true);
    expect(isSshSession(mk({}))).toBe(false);
  });

  it('解析 SSH 目标 user@host', () => {
    expect(sshTargetOf(mk({ kind: 'ssh', payload: '{"ssh":{"host":"prod.example.com","user":"root"}}' })))
      .toBe('root@prod.example.com');
    expect(sshTargetOf(mk({ kind: 'ssh', payload: '{"ssh":{"host":"h"}}' }))).toBe('h');
    expect(sshTargetOf(mk({ kind: 'local' }))).toBeNull();
  });
});

describe('filterSessions', () => {
  const ssh = mk({ id: 'ssh-1', title: '生产服务器', kind: 'ssh', payload: '{"ssh":{"host":"prod.example.com","user":"root"}}', closed_at: Date.now() });
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
});

it('finds SSH hosts in restored pane layouts with formatted JSON', () => {
  const session = mk({ payload: JSON.stringify({ layout: { type: 'leaf', terminal: { kind: 'ssh', ssh: { host: 'saved.example', user: 'dev' } } } }, null, 2) });
  expect(isSshSession(session)).toBe(true);
  expect(sshTargetOf(session)).toBe('dev@saved.example');
  expect(filterSessions([session], 'saved.example', 'ssh', 'all')).toEqual([session]);
});
