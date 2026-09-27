import { writeClipboardText } from '@platform/clipboard';
import { ptyWrite } from '@platform/pty';
import { useTerminalStore } from '@features/terminal/stores/terminal';
import { useToastStore } from '@ui/Toast';
import { terminalDebug } from '@features/terminal/services/terminalDebug';

export async function copyBlockText(text: string): Promise<boolean> {
  try {
    await writeClipboardText(text);
    terminalDebug('block-copy', { length: text.length });
    return true;
  } catch (error) {
    terminalDebug('block-copy-error', { error: String(error) });
    useToastStore.getState().addToast('复制失败，请选中文本后手动复制', 'error');
    return false;
  }
}

export async function rerunBlockCommand(paneId: string, command: string): Promise<void> {
  const sessionId = useTerminalStore.getState().sessions[paneId];
  if (!sessionId) {
    useToastStore.getState().addToast('终端尚未连接，无法重新运行', 'error');
    return;
  }
  try {
    await ptyWrite(sessionId, command + '\n');
    terminalDebug('block-rerun', { paneId, length: command.length });
  } catch (error) {
    terminalDebug('block-rerun-error', { paneId, error: String(error) });
    useToastStore.getState().addToast('重新运行失败，请检查终端连接', 'error');
  }
}
