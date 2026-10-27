import type { BackendSessionEntry } from '@platform/api/types';
import type { HistoryDirectoryTarget } from '@utils/historyDirectory';

export interface SavedHistoryTerminal extends HistoryDirectoryTarget {
  paneId?: string;
  shellType?: string;
  openMode?: 'block' | 'classic';
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Read the current terminal pane tree from a session payload. */
export function sessionHistoryTerminals(session: BackendSessionEntry): SavedHistoryTerminal[] {
  let payload: Record<string, unknown> = {};
  try { payload = record(JSON.parse(session.payload)) ?? {}; } catch { /* Invalid metadata has no terminals. */ }
  const terminals: Record<string, unknown>[] = [];
  const visit = (value: unknown) => {
    const node = record(value);
    if (!node) return;
    if (node.type === 'leaf') {
      const terminal = record(node.terminal);
      if (terminal) terminals.push(terminal);
    } else if (node.type === 'split') { visit(node.first); visit(node.second); }
  };
  visit(payload.layout);
  return terminals.map((terminal, index) => {
    const ssh = record(terminal.ssh);
    const kind = terminal.kind === 'ssh' || ssh ? 'ssh' : 'local';
    const cwd = typeof terminal.cwd === 'string' && terminal.cwd.trim() ? terminal.cwd : index === 0 ? session.cwd : '';
    return {
      ...(typeof terminal.id === 'string' ? { paneId: terminal.id } : {}),
      kind, cwd,
      shellType: typeof terminal.shellType === 'string' ? terminal.shellType : undefined,
      openMode: terminal.openMode === 'block' || terminal.openMode === 'classic' ? terminal.openMode : undefined,
      ssh: ssh ? {
        host: typeof ssh.host === 'string' ? ssh.host : undefined,
        user: typeof ssh.user === 'string' ? ssh.user : undefined,
        port: typeof ssh.port === 'number' && Number.isFinite(ssh.port) ? ssh.port : undefined,
      } : undefined,
      remoteId: typeof ssh?.connectionId === 'string' ? ssh.connectionId : session.id,
      remoteLabel: typeof ssh?.name === 'string' ? ssh.name : undefined,
    };
  });
}
