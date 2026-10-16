import type { Terminal } from '@xterm/xterm';
import { writeClipboardText, readClipboardText, hasClipboardImage } from '@platform/clipboard';
import { termInstances, useTerminalStore } from '@features/terminal/stores/terminal';
import { requestPasteConfirm, type PasteConfirmReason } from '@features/terminal/stores/pasteConfirm';
import { t } from '@i18n';
import { useToastStore } from '@ui/Toast';
import { terminalDebug } from './terminalDebug';
import { writeTerminalInput } from './terminalWriteQueue';

/** Pastes with more lines than this are confirmed before they reach the PTY. */
const PASTE_CONFIRM_LINES = 5;
/** Pastes longer than this many characters are confirmed even when the program handles pastes. */
const PASTE_CONFIRM_CHARS = 64 * 1024;

/** Lines the pasted text spans, counting the way a text editor shows it. */
export function pasteLineCount(text: string): number {
  return text.split(/\r\n|\r|\n/).length;
}

/**
 * Decide whether a paste asks first. A multi-line paste into a program that did not request
 * bracketed paste arrives as if the user typed the lines, so the shell runs each one; a payload
 * this large is worth a confirmation even when the program takes pasted text as one unit.
 */
export function pasteConfirmReason(text: string, bracketedPaste: boolean): PasteConfirmReason | null {
  if (text.length > PASTE_CONFIRM_CHARS) return 'size';
  if (!bracketedPaste && pasteLineCount(text) > PASTE_CONFIRM_LINES) return 'lines';
  return null;
}

/** Select the terminal that owns the current scene and its input modes. */
export function getPaneTerminal(paneId: string): Terminal | null {
  const main = termInstances.get(paneId);
  const block = termInstances.get(`block:${paneId}`);
  const { scenes, altScreenActive } = useTerminalStore.getState();
  // A manually fullscreened running block keeps showing its own terminal; only a real
  // alternate buffer hands the pane back to the main terminal.
  const blockSurface = scenes[paneId] === 'blockList' || (scenes[paneId] === 'altScreen' && altScreenActive);
  return blockSurface ? block ?? main ?? null : main ?? block ?? null;
}

/**
 * Copy the terminal selection: the xterm selection first, then the page selection (block output is
 * real DOM). Failures and an empty selection surface through a toast; the result reports whether
 * the clipboard really received the text.
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
 * Paste text through the active terminal so it can apply bracketed-paste mode and normalize line
 * endings. When the clipboard holds an image, the native paste key is written straight to the PTY
 * instead — the foreground process reads the image itself, and the key must not be transformed into
 * pasted text. Text without a registered terminal instance also falls back to a PTY write. A large
 * or multi-line paste asks first; the answer decides whether anything reaches the PTY at all.
 */
export async function pasteClipboardIntoTerminal(paneId: string): Promise<boolean> {
  const sessionId = useTerminalStore.getState().sessions[paneId];
  if (!sessionId) {
    useToastStore.getState().addToast(t('terminal.clipboard.noSession'), 'error');
    return false;
  }
  let text = '';
  let image = false;
  try {
    image = await hasClipboardImage();
    text = image ? '\x16' : await readClipboardText();
    terminalDebug('terminal-clipboard-paste', { paneId, image, chars: image ? 0 : text.length });
  } catch {
    useToastStore.getState().addToast(t('terminal.clipboard.pasteFailed'), 'error');
    return false;
  }
  if (!text) return false;
  // An image travels as the native paste *key*, not as pasted text: paste() applies the pasted-text
  // transformations (bracketed-paste wrapping, line-ending normalization), so a foreground program
  // that enabled bracketed paste would receive a literal control character instead of the key that
  // asks it to take the clipboard image. A key goes to the PTY as-is; text keeps the terminal path.
  const term = image ? null : getPaneTerminal(paneId);
  if (!image) {
    const reason = pasteConfirmReason(text, term?.modes.bracketedPasteMode ?? false);
    if (reason) {
      const confirmed = await requestPasteConfirm({ reason, lines: pasteLineCount(text), chars: text.length });
      terminalDebug('terminal-clipboard-paste-confirm', { paneId, reason, confirmed });
      if (!confirmed) return false;
    }
  }
  if (term) {
    term.paste(text);
    return true;
  }
  try {
    await writeTerminalInput(sessionId, text);
    return true;
  } catch {
    useToastStore.getState().addToast(t('terminal.clipboard.pasteFailed'), 'error');
    return false;
  }
}
