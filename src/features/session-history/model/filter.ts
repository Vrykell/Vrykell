import type { BackendSessionEntry } from '@platform/api/types';

export type SessionTypeFilter = 'all' | 'local' | 'ssh';
export type SessionDateFilter = 'all' | 'today' | '7d' | '30d' | '90d';
export type SessionModeFilter = 'all' | 'block' | 'classic';

/** Use saved pane modes, with the original defaults for legacy session metadata. */
export function sessionTerminalModes(session: BackendSessionEntry): Set<Exclude<SessionModeFilter, 'all'>> {
  const modes = new Set<Exclude<SessionModeFilter, 'all'>>();
  const terminalMode = (value: Record<string, unknown>) => {
    if (value.shellType === 'cmd') modes.add('classic');
    else if (value.openMode === 'block' || value.openMode === 'classic') modes.add(value.openMode);
    else modes.add(value.kind === 'ssh' || value.ssh || session.kind === 'ssh' ? 'classic' : 'block');
  };
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (node.type === 'leaf' && node.terminal && typeof node.terminal === 'object') terminalMode(node.terminal as Record<string, unknown>);
    else if (node.type === 'split') { visit(node.first); visit(node.second); }
  };
  try {
    const payload: unknown = JSON.parse(session.payload);
    if (payload && typeof payload === 'object') {
      const node = payload as Record<string, unknown>;
      if (node.layout) visit(node.layout);
      if (modes.size === 0) terminalMode(node);
    }
  } catch { /* Legacy metadata falls back to its saved session kind. */ }
  if (modes.size === 0) terminalMode({});
  return modes;
}

/** Read legacy targets and modern pane layouts without depending on JSON formatting. */
function sshTargets(session: BackendSessionEntry): Array<{ host?: string; user?: string | null }> {
  const targets: Array<{ host?: string; user?: string | null }> = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (node.ssh && typeof node.ssh === 'object') targets.push(node.ssh as { host?: string; user?: string | null });
    if (node.layout) visit(node.layout);
    if (node.terminal) visit(node.terminal);
    if (node.type === 'split') { visit(node.first); visit(node.second); }
  };
  try { visit(JSON.parse(session.payload)); } catch { /* Invalid legacy metadata has no target. */ }
  return targets;
}

export function isSshSession(session: BackendSessionEntry): boolean {
  return session.kind === 'ssh' || sshTargets(session).length > 0;
}

export function sshTargetOf(session: BackendSessionEntry): string | null {
  const targets = sshTargets(session).filter(target => typeof target.host === 'string' && target.host);
  return targets.length ? targets.map(target => target.user ? `${target.user}@${target.host}` : target.host).join(', ') : null;
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
  mode: SessionModeFilter = 'all',
): BackendSessionEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  return sessions.filter((session) => {
    if (type === 'ssh' && !isSshSession(session)) return false;
    if (type === 'local' && isSshSession(session)) return false;
    if (mode !== 'all' && !sessionTerminalModes(session).has(mode)) return false;
    if (!matchesDate(session, range)) return false;
    if (!normalizedQuery) return true;
    const haystack = [session.title, sshTargetOf(session) ?? '', session.cwd].join(' ').toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}
