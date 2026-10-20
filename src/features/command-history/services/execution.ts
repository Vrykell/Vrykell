import { commandEnvironment } from '@core/commandHistory';
import { t } from '@i18n';
import { writeTerminalCommand } from '@features/terminal/services/commandSubmission';
import { getAvailableShells, SHELL_TYPES, type ShellType } from '@platform/shells';
import { useSessionStore } from '@features/workspace';
import type { TerminalSpec } from '@features/workspace/model/windowLayout';
import { leaves } from '@features/workspace/model/windowLayout';
import { useBlockStore, useTerminalStore } from '@features/terminal';
import { useInputStore } from '@features/terminal/stores/input';
import { setPendingTerminalCommand } from '@features/terminal/hooks/useTerminalSession';
import { waitForTerminalStartup } from '@features/terminal/services/terminalStartup';
import { focusSessionInput } from '@features/terminal/services/terminalFocus';
import { agentControl } from '@features/agent/services/agentControl';
import { normalizeCommandPath, type CommandItem } from '../model/commands';

export interface ExecutionContext { target: string; spec: TerminalSpec; paneId: string; cwd: string; root: string; scope: string }
const submitting = new Set<string>();

export function currentRunError(context: ExecutionContext, item: CommandItem): string | null {
  const ws = useSessionStore.getState();
  const spec = ws.tabs.flatMap(tab => tab.kind === 'session' ? leaves(tab.layout) : []).find(pane => pane.id === context.paneId);
  const ts = useTerminalStore.getState();
  if (!spec || !ts.sessions[context.paneId] || ts.startupStates[context.paneId] !== 'ready') return t('The execution terminal is unavailable.');
  const environment = commandEnvironment(spec);
  if (environment.target !== context.target || environment.shell !== item.shell) return t('Choose a terminal with the same environment and shell.');
  if (normalizeCommandPath(ws.terminalCwds[context.paneId] ?? spec.cwd ?? '') !== normalizeCommandPath(item.cwd)) return t('The terminal directory differs. Choose a new terminal.');
  if (submitting.has(context.paneId) || agentControl.isControlled(context.paneId) || ts.scenes[context.paneId] === 'altScreen'
    || (useBlockStore.getState().byTab[context.paneId] ?? []).some(block => block.status === 'executing')) return t('The terminal is busy. Choose a new terminal.');
  return null;
}

export function fillHistoryCommand(context: ExecutionContext, item: CommandItem): void {
  const exists = useSessionStore.getState().tabs.some(tab => tab.kind === 'session' && leaves(tab.layout).some(pane => pane.id === context.paneId));
  if (!exists) throw new Error(t('The execution terminal is unavailable.'));
  const terminal = useTerminalStore.getState();
  if (terminal.startupStates[context.paneId] !== 'ready') throw new Error(t('The execution terminal is unavailable.'));
  if (terminal.scenes[context.paneId] === 'altScreen' || (useBlockStore.getState().byTab[context.paneId] ?? []).some(block => block.status === 'executing')) {
    throw new Error(t('The terminal is busy. Choose a new terminal.'));
  }
  useInputStore.getState().setAiMode(context.paneId, false);
  useInputStore.getState().setText(context.paneId, item.command);
  useTerminalStore.getState().setKeyboardTarget('input');
  requestAnimationFrame(() => focusSessionInput(context.paneId));
}

export function hasCommandDraft(paneId: string): boolean {
  const input = useInputStore.getState().byPane[paneId];
  return !!(input?.aiMode ? input.commandDraft : input?.text)?.trim();
}

export async function runHistoryCommand(context: ExecutionContext, item: CommandItem, location: 'current' | 'new'): Promise<void> {
  if (!item.command.trim() || item.command.includes('[redacted]')) throw new Error(t('Complete the redacted parameters before running this command.'));
  let paneId = context.paneId;
  if (location === 'new') {
    if (context.spec.kind === 'local' && item.shell !== 'system' && !SHELL_TYPES.includes(item.shell as ShellType)) throw new Error(t('Choose a terminal with the same environment and shell.'));
    if (context.spec.kind === 'local' && item.shell !== 'system' && !(await getAvailableShells()).some(shell => shell.id === item.shell)) {
      throw new Error(t('Choose a terminal with the same environment and shell.'));
    }
    const tabId = useSessionStore.getState().addTab({ kind: context.spec.kind, ssh: context.spec.ssh,
      cwd: item.cwd, shellType: context.spec.kind === 'local' && item.shell !== 'system' ? item.shell as ShellType : undefined, title: item.name });
    paneId = `${tabId}#0`;
    await waitForTerminalStartup(paneId);
  }
  const targetContext = { ...context, paneId };
  const error = currentRunError(targetContext, item);
  if (error) throw new Error(error);
  submitting.add(paneId);
  try {
    setPendingTerminalCommand(paneId, item.command);
    await writeTerminalCommand(paneId, useTerminalStore.getState().sessions[paneId]!, item.command);
  } finally { setTimeout(() => submitting.delete(paneId), 500); }
}
