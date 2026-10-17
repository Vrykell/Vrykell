export interface CommandEnvironment {
  kind: 'local' | 'ssh';
  shellType?: string;
  ssh?: { host: string; user?: string; port?: number; connectionId?: string; name?: string };
}

export function commandEnvironment(environment: CommandEnvironment): { target: string; shell: string } {
  return environment.kind === 'ssh'
    ? { target: JSON.stringify(['ssh', environment.ssh?.host.toLowerCase() ?? '', environment.ssh?.port ?? 22, environment.ssh?.user ?? '']), shell: 'posix' }
    : { target: 'local', shell: environment.shellType ?? 'system' };
}

export interface HistoryCommandEntry {
  id: string;
  target: string;
  shell: string;
  command: string;
  name?: string;
  cwd: string;
  status: 'running' | 'success' | 'failed' | 'unknown';
  exitCode: number | null;
  timestamp: number;
  runCount: number;
}

export interface HistoryCommandRule { id: string; kind: 'name' | 'prefix'; value: string }
export interface HistoryCommandFavorite { id: string; name: string; command: string; cwd: string; shell: string }
export type HistoryCommandKey = Pick<HistoryCommandFavorite, 'shell' | 'cwd' | 'command'>;
export type HistoryCommandDraft = Omit<HistoryCommandFavorite, 'id'>;
export interface HistoryCommandGroup { id: string; name: string; commandKeys: string[] }
export interface HistoryCommandMutation {
  target: string;
  root: string;
  scope: string;
  original: HistoryCommandKey | null;
  draft: HistoryCommandDraft | null;
  preferences: HistoryCommandPreferences;
}
export interface HistoryCommandPreferences {
  favorites: HistoryCommandFavorite[];
  hidden: string[];
  rules: HistoryCommandRule[];
  /** Read only for migration from per-project behavior settings. */
  runIn?: 'current' | 'new';
  groups?: HistoryCommandGroup[];
  groupColors?: Record<string, string>;
  historyOrder?: string[];
  groupOrder?: string[];
}
export interface HistoryCommandContext { root: string; files: { path: string; text: string }[]; platform: string }
