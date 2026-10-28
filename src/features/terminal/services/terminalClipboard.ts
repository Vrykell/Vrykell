import type { Terminal } from '@xterm/xterm';
import { writeClipboardText, readClipboardText, hasClipboardImage } from '@platform/clipboard';
import { termInstances, useTerminalStore } from '@features/terminal/stores/terminal';
import { requestPasteConfirm, type PasteConfirmReason } from '@features/terminal/stores/pasteConfirm';
import { t } from '@i18n';
import { useToastStore } from '@ui/feedback/Toast';
import { terminalDebug } from './terminalDebug';
import { writeTerminalInput, writeTerminalPaste } from './terminalWriteQueue';
import { ptyInputEpoch } from '@platform/pty';
import { useBlockStore } from '@features/terminal/stores/blocks';

/** Pastes longer than this many characters are confirmed even when the program handles pastes. */
const PASTE_CONFIRM_CHARS = 64 * 1024;

function pasteTarget(paneId: string) {
  const state = useTerminalStore.getState();
  const sessionId = state.sessions[paneId];
  const term = getPaneTerminal(paneId);
  const scene = state.scenes[paneId];
  const manual = state.manualFullscreen[paneId];
  const bracketed = term?.modes.bracketedPasteMode;
  const running = () => (useBlockStore.getState().byTab[paneId] ?? []).filter(block => block.status === 'executing').map(block => block.id).join(':');
  const blockId = running();
  return { sessionId, term, isCurrent: () => {
    const current = useTerminalStore.getState();
    return current.sessions[paneId] === sessionId && current.scenes[paneId] === scene
      && current.manualFullscreen[paneId] === manual && getPaneTerminal(paneId) === term
      && term?.modes.bracketedPasteMode === bracketed && running() === blockId;
  } };
}

function cancelledPaste(paneId: string): false {
  terminalDebug('terminal-paste-target-changed', { paneId });
  useToastStore.getState().addToast(t('Paste stopped because the foreground application changed. The remaining text was not sent.'), 'info');
  return false;
}

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
  if (!bracketedPaste && /[\r\n]/.test(text)) return 'lines';
  return null;
}

/** Select the terminal that owns the current scene and its input modes. */
export function getPaneTerminal(paneId: string): Terminal | null {
  const main = termInstances.get(paneId);
  const block = termInstances.get(`block:${paneId}`);
  const { scenes, manualFullscreen } = useTerminalStore.getState();
  // A manually fullscreened running block keeps showing its own terminal; only a real
  // alternate buffer hands the pane back to the main terminal.
  const blockSurface = scenes[paneId] === 'blockList' || (scenes[paneId] === 'altScreen' && manualFullscreen[paneId]);
  return blockSurface ? block ?? main ?? null : main ?? block ?? null;
}

/**
 * Whether the copy shortcut has something to copy: the terminal's own selection or page text
 * selected in a block. The terminal keeps focus during block selection, so a plain Ctrl+C must
 * still copy the page selection instead of sending an interrupt.
 */
export function hasCopyableSelection(term: Terminal | null | undefined): boolean {
  return Boolean(term?.getSelection() || window.getSelection()?.toString());
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
 * pasted text. Multiline scripts at the block prompt are staged in the command input. Other
 * multiline pastes require bracketed-paste support or confirmation before reaching the PTY.
 */
export async function pasteClipboardIntoTerminal(paneId: string): Promise<boolean> {
  const target = pasteTarget(paneId);
  const sessionId = target.sessionId;
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
  if (!target.isCurrent()) return cancelledPaste(paneId);
  if (!image) return pasteTextIntoTerminal(paneId, text, target);
  try {
    // Image paste is a native key, never a pasted text payload.
    const epoch = await ptyInputEpoch(sessionId);
    await writeTerminalPaste(sessionId, { epoch, isCurrent: target.isCurrent }, () => { void writeTerminalInput(sessionId, text); });
    return target.isCurrent() || cancelledPaste(paneId);
  } catch (error) {
    if (!target.isCurrent() || String(error).includes('terminal input target changed')) return cancelledPaste(paneId);
    useToastStore.getState().addToast(t('terminal.clipboard.pasteFailed'), 'error');
    return false;
  }
}

/** Route native paste events and clipboard shortcuts through the same multiline policy. */
export async function pasteTextIntoTerminal(paneId: string, text: string, target = pasteTarget(paneId)): Promise<boolean> {
  const state = useTerminalStore.getState();
  const sessionId = target.sessionId;
  if (!sessionId || !text) return false;
  if (!target.isCurrent()) return cancelledPaste(paneId);
  const running = (useBlockStore.getState().byTab[paneId] ?? []).some(block => block.status === 'executing');
  if (state.scenes[paneId] === 'blockList' && !running && /[\r\n]/.test(text)) {
    state.stageCommand(paneId, text);
    return true;
  }
  const term = target.term;
  let epoch: number;
  try { epoch = await ptyInputEpoch(sessionId); }
  catch (error) {
    if (!target.isCurrent() || String(error).includes('terminal input target changed')) return cancelledPaste(paneId);
    useToastStore.getState().addToast(t('terminal.clipboard.pasteFailed'), 'error'); return false;
  }
  const reason = pasteConfirmReason(text, term?.modes.bracketedPasteMode ?? false);
  if (reason) {
    const confirmed = await requestPasteConfirm({ reason, lines: pasteLineCount(text), chars: text.length });
    terminalDebug('terminal-clipboard-paste-confirm', { paneId, reason, confirmed });
    if (!confirmed) return false;
  }
  // A dialog may outlive its original session or foreground terminal.
  if (!target.isCurrent()) return cancelledPaste(paneId);
  try {
    await writeTerminalPaste(sessionId, { epoch, isCurrent: target.isCurrent }, () => {
      if (term) term.paste(text);
      else void writeTerminalInput(sessionId, text);
    });
    return target.isCurrent() || cancelledPaste(paneId);
  } catch (error) {
    if (!target.isCurrent() || String(error).includes('terminal input target changed')) return cancelledPaste(paneId);
    useToastStore.getState().addToast(t('terminal.clipboard.pasteFailed'), 'error');
    return false;
  }
}

/** Capture browser paste before the terminal's native handler can write embedded newlines. */
export function captureTerminalPaste(term: Terminal, paneId: string): () => void {
  const element = term.element;
  const onPaste = (event: ClipboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.clipboardData?.files.length) void pasteClipboardIntoTerminal(paneId);
    else void pasteTextIntoTerminal(paneId, event.clipboardData?.getData('text/plain') ?? '');
  };
  element?.addEventListener('paste', onPaste, { capture: true });
  return () => element?.removeEventListener('paste', onPaste, { capture: true });
}
