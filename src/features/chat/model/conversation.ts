export interface ChatEnvironment {
  paneId: string;
  label: string;
  kind: 'local' | 'ssh';
  cwd?: string;
  shellType?: string;
  aiNotes?: string;
  ssh?: { host: string; user?: string; port?: number };
}

export interface TerminalReference {
  id: string;
  paneId: string;
  label: string;
  command: string;
  output: string;
  cwd?: string;
  exitCode?: number | null;
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  environment: ChatEnvironment | null;
}

export function parseEnvironment(raw: string): ChatEnvironment | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const entry = value as Record<string, unknown>;
    if (typeof entry.paneId !== 'string' || typeof entry.label !== 'string' || (entry.kind !== 'local' && entry.kind !== 'ssh')) return null;
    const ssh = typeof entry.ssh === 'object' && entry.ssh !== null ? entry.ssh as Record<string, unknown> : null;
    return { paneId: entry.paneId, label: entry.label, kind: entry.kind, cwd: typeof entry.cwd === 'string' ? entry.cwd : undefined,
      ...(typeof entry.shellType === 'string' ? { shellType: entry.shellType } : {}),
      ...(typeof entry.aiNotes === 'string' && new TextEncoder().encode(entry.aiNotes).length <= 16384 ? { aiNotes: entry.aiNotes } : {}),
      ...(entry.kind === 'ssh' && typeof ssh?.host === 'string' ? { ssh: {
        host: ssh.host,
        ...(typeof ssh.user === 'string' ? { user: ssh.user } : {}),
        ...(typeof ssh.port === 'number' && Number.isFinite(ssh.port) ? { port: ssh.port } : {}),
      } } : {}),
    };
  } catch { return null; }
}

export function parseReferences(raw: string): TerminalReference[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is TerminalReference => typeof entry === 'object' && entry !== null
      && typeof entry.id === 'string' && typeof entry.paneId === 'string' && typeof entry.label === 'string'
      && typeof entry.command === 'string' && typeof entry.output === 'string' && typeof entry.createdAt === 'number');
  } catch { return []; }
}

export function referenceHistoryText(references?: TerminalReference[]): string {
  if (!references?.length) return '';
  return '\n\n' + references.map(reference => [
    `[Terminal snapshot: ${reference.label}]`,
    reference.cwd ? `Directory: ${reference.cwd}` : '',
    reference.exitCode != null ? `Exit code: ${reference.exitCode}` : '',
    `$ ${reference.command}`, reference.output,
  ].filter(Boolean).join('\n')).join('\n\n');
}
