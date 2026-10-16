import type { BackendSessionEntry } from '@platform/api/types';
import { sessionHistoryTerminals } from './sessionMetadata';

export type SessionTypeFilter = 'all' | 'local' | 'ssh';
export type SessionDateFilter = 'all' | 'today' | '7d' | '30d' | '90d';
export type SessionModeFilter = 'all' | 'block' | 'classic';

/** Use saved pane modes, with the original defaults for legacy session metadata. */
export function sessionTerminalModes(session: BackendSessionEntry): Set<Exclude<SessionModeFilter, 'all'>> {
  return new Set(sessionHistoryTerminals(session).map(terminal => terminal.shellType === 'cmd' ? 'classic'
    : terminal.openMode ?? (terminal.kind === 'ssh' ? 'classic' : 'block')));
}

export function isSshSession(session: BackendSessionEntry): boolean {
  return sessionHistoryTerminals(session).some(terminal => terminal.kind === 'ssh');
}

export function sshTargetOf(session: BackendSessionEntry): string | null {
  const targets = sessionHistoryTerminals(session).flatMap(terminal => terminal.ssh?.host ? [terminal.ssh] : []);
  return targets.length ? [...new Set(targets.map(target => `${target.user ? `${target.user}@` : ''}${target.host}${target.port && target.port !== 22 ? `:${target.port}` : ''}`))].join(', ') : null;
}

const DATE_MS: Record<Exclude<SessionDateFilter, 'all' | 'today'>, number> = {
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

function matchesDate(session: BackendSessionEntry, range: SessionDateFilter, dateField: 'created' | 'closed'): boolean {
  if (range === 'all') return true;
  const timestamp = dateField === 'created' ? session.created_at : session.closed_at ?? session.created_at;
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
  mode: SessionModeFilter = 'all',
  dateField: 'created' | 'closed' = 'closed',
  /** When provided, only records whose id is in this set are kept (starred-only filtering). */
  starredIds: ReadonlySet<string> | null = null,
  searchAnnotations: ReadonlyMap<string, string> | null = null,
): BackendSessionEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  return sessions.filter((session) => {
    if (starredIds && !starredIds.has(session.id)) return false;
    const terminals = sessionHistoryTerminals(session);
    if (type !== 'all' && !terminals.some(terminal => terminal.kind === type)) return false;
    if (mode !== 'all' && !sessionTerminalModes(session).has(mode)) return false;
    if (!matchesDate(session, range, dateField)) return false;
    if (!normalizedQuery) return true;
    const haystack = [session.title, sshTargetOf(session) ?? '', searchAnnotations?.get(session.id) ?? '', ...terminals.map(terminal => terminal.cwd ?? '')].join(' ').toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}
