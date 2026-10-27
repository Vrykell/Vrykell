import { writeClipboardText } from '@platform/clipboard';
import { writeTerminalCommand } from './commandSubmission';
import { useTerminalStore } from '@features/terminal/stores/terminal';
import { useToastStore } from '@ui/feedback/Toast';
import { terminalDebug } from '@features/terminal/services/terminalDebug';
import { t } from '@i18n';

export async function copyBlockText(text: string): Promise<boolean> {
  try {
    await writeClipboardText(text);
    terminalDebug('block-copy', { length: text.length });
    return true;
  } catch (error) {
    terminalDebug('block-copy-error', { error: String(error) });
    useToastStore.getState().addToast(t('Copy failed. Select the text to copy it manually.'), 'error');
    return false;
  }
}

export async function rerunBlockCommand(paneId: string, command: string): Promise<void> {
  const sessionId = useTerminalStore.getState().sessions[paneId];
  if (!sessionId) {
    useToastStore.getState().addToast(t('The terminal is not connected; cannot run again.'), 'error');
    return;
  }
  try {
    await writeTerminalCommand(paneId, sessionId, command);
    terminalDebug('block-rerun', { paneId, length: command.length });
  } catch (error) {
    terminalDebug('block-rerun-error', { paneId, error: String(error) });
    useToastStore.getState().addToast(t('Run failed. Check the terminal connection.'), 'error');
  }
}
