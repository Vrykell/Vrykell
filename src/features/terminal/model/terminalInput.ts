import type { Terminal } from '@xterm/xterm';
import { configureLiteralInput } from '@ui/TextInput';
import { terminalDebug } from '../services/terminalDebug';

const configured = new WeakSet<HTMLTextAreaElement>();

/** Position preedit before it becomes visible, retaining native candidate placement. */
export function configureTerminalInput(term: Terminal): void {
  const input = term.textarea;
  if (!input) return;
  configureLiteralInput(input);
  if (configured.has(input)) return;
  configured.add(input);
  terminalDebug('terminal-input-policy', { autocorrect: false, capitalization: false, spellcheck: false });
  // Native text commits can omit keypress while still marking input as composed.
  // Observe xterm's output first so fallback commits never duplicate handled keys.
  let emitted = 0;
  let keyStart = 0;
  let composing = false;
  let compositionCommitted = false;
  term.onData?.(() => { emitted++; });
  term.element?.addEventListener('keydown', event => {
    // Only snapshot what xterm has emitted. The composition guard is consumed by the next
    // input event instead of being cleared here: an IME switch that commits a pending preedit
    // fires its keydown after xterm handled the commit, so clearing early would let the same
    // native commit be forwarded a second time by the fallback below.
    keyStart = emitted;
    terminalDebug('terminal-native-key', { composing: event.isComposing || composing,
      imeKey: event.keyCode === 229, printable: event.key.length === 1,
      modified: event.ctrlKey || event.altKey || event.metaKey, readonly: input.readOnly });
  }, { capture: true });
  input.addEventListener('focus', () => {
    const rect = input.getBoundingClientRect();
    terminalDebug('terminal-native-focus', { visible: input.getClientRects().length > 0,
      blocked: Boolean(input.closest('[inert]')), width: rect.width, height: rect.height });
  });
  input.addEventListener('compositionstart', () => { composing = true; compositionCommitted = false; }, { capture: true });
  input.addEventListener('compositionend', () => { composing = false; compositionCommitted = true; }, { capture: true });
  input.addEventListener('input', event => {
    const commit = event as InputEvent;
    // Consume the post-composition guard on the first input event it protects: the native
    // commit right after compositionend is exactly the one that must not be forwarded twice.
    const composed = compositionCommitted;
    compositionCommitted = false;
    terminalDebug('terminal-native-input', { inputType: commit.inputType,
      composing: composing || commit.isComposing, chars: commit.data?.length ?? 0, consumed: emitted !== keyStart });
    if (commit.inputType !== 'insertText' || !commit.data || composing || composed || commit.isComposing || emitted !== keyStart) return;
    const expected = emitted;
    const data = commit.data;
    // Native IME keys schedule xterm's textarea diff after this event. Clearing
    // the value now can turn its pending insertion into a spurious backspace.
    setTimeout(() => {
      if (emitted !== expected || composing || compositionCommitted || input.readOnly) return;
      term.input(data, true);
      input.value = '';
      terminalDebug('terminal-native-input-fallback', { chars: data.length });
    }, 0);
  });
  input.addEventListener('compositionstart', () => {
    const view = term.element?.querySelector<HTMLElement>('.composition-view');
    if (!view) return;
    view.style.left = input.style.left;
    view.style.top = input.style.top;
    view.style.fontFamily = term.options.fontFamily ?? '';
    view.style.fontSize = `${term.options.fontSize ?? 14}px`;
    view.style.lineHeight = input.style.lineHeight;
    terminalDebug('terminal-composition-anchor', { positioned: Boolean(input.style.top && input.style.left) });
  }, { capture: true });
}
