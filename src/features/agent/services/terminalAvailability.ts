import { t } from '@i18n';
import { useTerminalStore } from '@features/terminal/stores/terminal';

export function terminalDisconnected(paneId: string, expectedSessionId?: string) {
  const state = useTerminalStore.getState();
  if (state.sessions[paneId] && (!expectedSessionId || state.sessions[paneId] === expectedSessionId) && state.startupStates[paneId] !== 'closed' && state.startupStates[paneId] !== 'failed') return null;
  return { ok: false as const, completed: false, output: '', code: 'TERMINAL_DISCONNECTED', requiresUserAction: true,
    error: t('The selected execution terminal disconnected. The command was not confirmed as completed. Ask the user to reconnect or select another terminal; do not switch targets or retry automatically.') };
}
