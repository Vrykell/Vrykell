import type { BackendSessionEntry } from '@/search/types';

export type SessionTypeFilter = 'all' | 'local' | 'ssh';
export type SessionDateFilter = 'all' | 'today' | '7d' | '30d' | '90d';

export function isSshSession(session: BackendSessionEntry): boolean {
  return session.kind === 'ssh' || (typeof session.payload === 'string' && session.payload.includes('"kind":"ssh"'));
}

export function sshTargetOf(session: BackendSessionEntry): string | null {
  if (session.kind !== 'ssh') return null;
  try {
    const payload = JSON.parse(session.payload) as { ssh?: { host?: string; user?: string | null } };
    const host = payload.ssh?.host;
    if (!host) return null;
    const user = payload.ssh?.user;
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

function matchesDate(session: BackendSessionEntry, range: SessionDateFilter): boolean {
  if (range === 'all') return true;
  const timestamp = session.status === 'historical' ? session.closed_at : session.created_at;
  if (!timestamp) return false;
  if (range === 'today') {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    return timestamp >= dayStart.getTime();
  }
  return timestamp >= Date.now() - DATE_MS[range];
}

export function filterSessions(
  sessions: BackendSessionEntry[],
  query: string,
  type: SessionTypeFilter,
  range: SessionDateFilter,
): BackendSessionEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  return sessions.filter((session) => {
    if (type === 'ssh' && !isSshSession(session)) return false;
    if (type === 'local' && isSshSession(session)) return false;
    if (!matchesDate(session, range)) return false;
    if (!normalizedQuery) return true;
    const haystack = [session.title, sshTargetOf(session) ?? '', session.cwd].join(' ').toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}
