import { commandEnvironment, type CommandEnvironment } from '@core/commandHistory';
import { recordHistoryCommand } from '@platform/api/commandHistory';
import { diagnostic } from '@platform/diagnostics';
import type { TermBlock } from '@features/terminal/services/pipeline/termBlock';

let revision = 0;
const listeners = new Set<() => void>();
export const commandRevision = () => revision;
export const subscribeCommandHistory = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function announceCommandHistory() { revision++; listeners.forEach(listener => listener()); }

export function captureHistoryCommand(environment: CommandEnvironment, sessionId: string, block: TermBlock) {
  if (!block.command.trim() || !block.cwd) return;
  const scope = commandEnvironment(environment);
  void recordHistoryCommand({ ...scope, id: `${sessionId}:${block.id}`, command: block.command, cwd: block.cwd,
    status: block.status === 'executing' ? 'running' : block.exitCode === null ? 'unknown' : block.exitCode === 0 ? 'success' : 'failed',
    exitCode: block.exitCode, timestamp: block.startedAt ?? Date.now(), runCount: 1,
  }).then(announceCommandHistory).catch(error => diagnostic('command-history-record-error', { error }));
}
