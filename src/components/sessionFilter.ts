/**
 * sessionFilter — 会话历史页的筛选纯函数（搜索 + 类型 + 日期）。
 * 数据来自 list_sessions，全部在前端过滤，后端零改动。
 */

import type { BackendSessionEntry } from '../search/types';

export type SessionTypeFilter = 'all' | 'local' | 'ssh';
export type SessionDateFilter = 'all' | 'today' | '7d' | '30d' | '90d';

/** 判断会话（窗口）是否含 SSH 终端（布局 payload 里出现 kind=ssh）。 */
export function isSshSession(s: BackendSessionEntry): boolean {
  return s.kind === 'ssh' || (typeof s.payload === 'string' && s.payload.includes('"kind":"ssh"'));
}

/** 从 payload 解析 SSH 目标（user@host），非 SSH 会话返回 null。 */
export function sshTargetOf(s: BackendSessionEntry): string | null {
  if (s.kind !== 'ssh') return null;
  try {
    const p = JSON.parse(s.payload) as { ssh?: { host?: string; user?: string | null } };
    const host = p.ssh?.host;
    if (!host) return null;
    const user = p.ssh?.user;
    return user ? `${user}@${host}` : host;
  } catch {
    return null;
  }
}

const DATE_MS: Record<Exclude<SessionDateFilter, 'all' | 'today'>, number> = {
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

/** 日期范围判定：历史会话按关闭时间，活跃会话按创建时间。宽松取整：7/30/90 天为滑动窗口。 */
function matchesDate(s: BackendSessionEntry, range: SessionDateFilter): boolean {
  if (range === 'all') return true;
  const ts = s.status === 'historical' ? s.closed_at : s.created_at;
  if (!ts) return false;
  if (range === 'today') {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    return ts >= dayStart.getTime();
  }
  return ts >= Date.now() - DATE_MS[range];
}

/** 筛选会话：搜索 + 类型 + 日期全部命中才保留。 */
export function filterSessions(
  sessions: BackendSessionEntry[],
  query: string,
  type: SessionTypeFilter,
  range: SessionDateFilter,
): BackendSessionEntry[] {
  const q = query.trim().toLowerCase();
  return sessions.filter((s) => {
    if (type === 'ssh' && !isSshSession(s)) return false;
    if (type === 'local' && isSshSession(s)) return false;
    if (!matchesDate(s, range)) return false;
    if (q) {
      const haystack = [s.title, sshTargetOf(s) ?? '', s.cwd].join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}