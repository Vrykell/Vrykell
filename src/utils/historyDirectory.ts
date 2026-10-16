export interface HistoryDirectoryTarget {
  kind: 'local' | 'ssh';
  cwd?: string;
  ssh?: { host?: string; user?: string; port?: number };
  remoteId?: string;
  remoteLabel?: string;
}

/** Directory identity includes the remote authority, never just the path. */
export function historyDirectory(target: HistoryDirectoryTarget, unknownLabel: string): { id: string; title: string } {
  const raw = target.cwd?.trim() ?? '';
  const windows = target.kind === 'local' && (/^[a-z]:[\\/]/i.test(raw) || raw.startsWith('\\\\'));
  const stripped = (windows ? raw.replace(/\\/g, '/') : raw).replace(/\/+$/, '');
  const path = windows && /^[a-z]:$/i.test(stripped) ? `${stripped}/` : stripped || (raw.startsWith('/') ? '/' : '');
  const key = windows ? path.toLowerCase() : path;
  if (target.kind === 'local') return path
    ? { id: `cwd:${key}`, title: path }
    : { id: 'cwd:unknown', title: unknownLabel };

  const host = target.ssh?.host?.trim().toLowerCase() ?? '';
  const user = target.ssh?.user?.trim() ?? '';
  const port = target.ssh?.port ?? 22;
  const formattedHost = host.includes(':') ? `[${host}]` : host;
  const authority = host ? `${user ? `${user}@` : ''}${formattedHost}${port === 22 ? '' : `:${port}`}` : target.remoteLabel || 'SSH';
  return {
    id: `cwd:ssh:${JSON.stringify([host || target.remoteId || 'unknown', user, port, path])}`,
    title: `${authority} · ${path || unknownLabel}`,
  };
}
