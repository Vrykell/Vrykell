import { isSessionTab, useWorkspaceStore } from '@features/workspace/stores/workspace';
import { leaves } from '@features/workspace/model/windowLayout';
import { isWindows } from '@platform/runtime';
import { formatCommandSubmission, type CommandShell } from '../model/commandSubmission';
import { writeTerminalInput } from './terminalWriteQueue';
import { terminalDebug } from './terminalDebug';

export function terminalCommandPayload(paneId: string, command: string): string {
  const pane = useWorkspaceStore.getState().tabs.flatMap(tab => isSessionTab(tab) ? leaves(tab.layout) : [])
    .find(item => item.id === paneId);
  const shell: CommandShell = pane?.kind === 'ssh' ? 'posix'
    : pane?.shellType === 'cmd' ? 'cmd'
    : ['powershell', 'pwsh'].includes(pane?.shellType ?? '') || (!pane?.shellType && isWindows) ? 'powershell' : 'posix';
  return formatCommandSubmission(command, shell);
}

/** Explicit command execution shares one serializer and the ordered terminal input queue. */
export function writeTerminalCommand(paneId: string, sessionId: string, command: string): Promise<void> {
  const payload = terminalCommandPayload(paneId, command);
  terminalDebug('terminal-command-submission', {
    paneId, sessionId, sourceLines: command.split(/\r\n|\r|\n/).length,
    sourceChars: command.length, payloadChars: payload.length, wireLines: payload.split('\n').length - 1,
  });
  return writeTerminalInput(sessionId, payload);
}
