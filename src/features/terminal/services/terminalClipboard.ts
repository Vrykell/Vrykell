import type { Terminal } from '@xterm/xterm';
import { writeClipboardText, readClipboardText, hasClipboardImage } from '@platform/clipboard';
import { ptyWrite } from '@platform/pty';
import { termInstances, useTerminalStore } from '@features/terminal/stores/terminal';
import { t } from '@i18n';
import { useToastStore } from '@ui/Toast';
import { terminalDebug } from './terminalDebug';

/** Select the terminal that owns the current scene and its input modes. */
export function getPaneTerminal(paneId: string): Terminal | null {
  const main = termInstances.get(paneId);
  const block = termInstances.get(`block:${paneId}`);
  return useTerminalStore.getState().scenes[paneId] === 'blockList'
    ? block ?? main ?? null
    : main ?? block ?? null;
}

/**
 * 复制终端选中文本：优先 xterm 选区，其次页面 DOM 选区（块列表输出为真实 DOM）。
 * 失败与空选区通过 Toast 反馈，返回是否真的写入了剪贴板。
 */
export async function copyTerminalSelection(term: Terminal | null | undefined): Promise<boolean> {
  const text = term?.getSelection() || window.getSelection()?.toString() || '';
  if (!text) {
    useToastStore.getState().addToast(t('terminal.clipboard.copyEmpty'), 'info');
    return false;
  }
  try {
    await writeClipboardText(text);
    return true;
  } catch {
    useToastStore.getState().addToast(t('terminal.clipboard.copyFailed'), 'error');
    return false;
  }
}

/**
 * Paste through the active terminal so it can apply bracketed-paste mode and normalize line endings.
 * When the clipboard contains an image, send the native paste key so the foreground process can
 * read it. If no terminal instance is registered, write text directly to the pane's PTY.
 */
export async function pasteClipboardIntoTerminal(paneId: string): Promise<boolean> {
  const sessionId = useTerminalStore.getState().sessions[paneId];
  if (!sessionId) {
    useToastStore.getState().addToast(t('terminal.clipboard.noSession'), 'error');
    return false;
  }
  let text = '';
  try {
    const image = await hasClipboardImage();
    text = image ? '\x16' : await readClipboardText();
    terminalDebug('terminal-clipboard-paste', { paneId, image, chars: image ? 0 : text.length });
  } catch {
    useToastStore.getState().addToast(t('terminal.clipboard.pasteFailed'), 'error');
    return false;
  }
  if (!text) return false;
  const term = getPaneTerminal(paneId);
  if (term) {
    term.paste(text);
    return true;
  }
  try {
    await ptyWrite(sessionId, text);
    return true;
  } catch {
    useToastStore.getState().addToast(t('terminal.clipboard.pasteFailed'), 'error');
    return false;
  }
}
