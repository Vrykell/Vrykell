import { useTerminalStore } from '../stores/terminal';
import { useWorkspaceStore } from '@features/workspace/stores/workspace';
import { leaves } from '@features/workspace/model/windowLayout';
import { t } from '@i18n';

/** Wait for a live shell prompt, rejecting shutdown and startup failures without polling. */
export function waitForTerminalStartup(paneId: string, timeoutMs = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribeTerminal = () => {};
    let unsubscribeWorkspace = () => {};
    const finish = (sessionId?: string, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      unsubscribeTerminal();
      unsubscribeWorkspace();
      if (sessionId) resolve(sessionId);
      else reject(new Error(error));
    };
    const check = () => {
      const state = useTerminalStore.getState();
      const exists = useWorkspaceStore.getState().tabs.some(tab =>
        tab.kind === 'session' && leaves(tab.layout).some(pane => pane.id === paneId));
      if (!exists || state.startupStates[paneId] === 'closed') finish(undefined, t('File opening cancelled: the terminal was closed'));
      else if (state.startupStates[paneId] === 'failed') finish(undefined, t('Could not open the file: the terminal failed to start'));
      else if (state.startupStates[paneId] === 'ready' && state.sessions[paneId]) finish(state.sessions[paneId]);
    };
    const timeout = setTimeout(() => finish(undefined, t('The terminal took too long to start; no shell-ready response arrived, please retry')), timeoutMs);
    unsubscribeTerminal = useTerminalStore.subscribe(check);
    unsubscribeWorkspace = useWorkspaceStore.subscribe(check);
    check();
  });
}
