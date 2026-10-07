/**
 * win32-input-mode: ConPTY asks the terminal for Win32 key records instead of
 * VT key encodings.
 *
 * ConPTY emits `CSI ? 9001 h` when it wants full KEY_EVENT_RECORD fidelity and
 * `CSI ? 9001 l` to drop it again. A terminal that accepts has to report every
 * key as
 *
 *   CSI Vk ; Sc ; Uc ; Kd ; Cs ; Rc _
 *
 * where Vk is the virtual key code, Sc the scan code, Uc the produced
 * character, Kd the key-down flag, Cs the control-key state and Rc the repeat
 * count (see microsoft/terminal doc/specs #4999). xterm.js ignores the request,
 * so an application that expects the record stream sees no keystrokes at all in
 * those sessions. Encoding the keys here restores the capability.
 *
 * Nothing changes until a session actually asks for the mode: the tracker starts
 * disabled and any VT-only session keeps xterm.js behaviour untouched.
 */

const ENABLE = '\x1b[?9001h';
const DISABLE = '\x1b[?9001l';

/** Control-key state bits (dwControlKeyState). */
const RIGHT_ALT = 0x01;
const LEFT_ALT = 0x02;
const RIGHT_CTRL = 0x04;
const LEFT_CTRL = 0x08;
const SHIFT = 0x10;
const NUMLOCK = 0x20;
const CAPSLOCK = 0x80;

/** Scan code per `KeyboardEvent.code`; unknown keys report 0, which the format allows. */
const SCAN_CODES: Record<string, number> = {
  Escape: 0x01,
  Digit1: 0x02, Digit2: 0x03, Digit3: 0x04, Digit4: 0x05, Digit5: 0x06,
  Digit6: 0x07, Digit7: 0x08, Digit8: 0x09, Digit9: 0x0a, Digit0: 0x0b,
  Minus: 0x0c, Equal: 0x0d, Backspace: 0x0e, Tab: 0x0f,
  KeyQ: 0x10, KeyW: 0x11, KeyE: 0x12, KeyR: 0x13, KeyT: 0x14, KeyY: 0x15,
  KeyU: 0x16, KeyI: 0x17, KeyO: 0x18, KeyP: 0x19,
  BracketLeft: 0x1a, BracketRight: 0x1b, Enter: 0x1c, ControlLeft: 0x1d,
  KeyA: 0x1e, KeyS: 0x1f, KeyD: 0x20, KeyF: 0x21, KeyG: 0x22, KeyH: 0x23,
  KeyJ: 0x24, KeyK: 0x25, KeyL: 0x26, Semicolon: 0x27, Quote: 0x28,
  Backquote: 0x29, ShiftLeft: 0x2a, Backslash: 0x2b,
  KeyZ: 0x2c, KeyX: 0x2d, KeyC: 0x2e, KeyV: 0x2f, KeyB: 0x30, KeyN: 0x31,
  KeyM: 0x32, Comma: 0x33, Period: 0x34, Slash: 0x35, ShiftRight: 0x36,
  NumpadMultiply: 0x37, AltLeft: 0x38, Space: 0x39, CapsLock: 0x3a,
  F1: 0x3b, F2: 0x3c, F3: 0x3d, F4: 0x3e, F5: 0x3f, F6: 0x40,
  F7: 0x41, F8: 0x42, F9: 0x43, F10: 0x44,
  NumLock: 0x45, ScrollLock: 0x46,
  Home: 0x47, ArrowUp: 0x48, PageUp: 0x49, NumpadSubtract: 0x4a,
  ArrowLeft: 0x4b, Numpad5: 0x4c, ArrowRight: 0x4d, NumpadAdd: 0x4e,
  End: 0x4f, ArrowDown: 0x50, PageDown: 0x51, Insert: 0x52, Delete: 0x53,
  IntlBackslash: 0x56, F11: 0x57, F12: 0x58,
  ControlRight: 0x1d, AltRight: 0x38, NumpadEnter: 0x1c,
  Numpad0: 0x52, Numpad1: 0x4f, Numpad2: 0x50, Numpad3: 0x51,
  Numpad4: 0x4b, Numpad6: 0x4d, Numpad7: 0x47, Numpad8: 0x48, Numpad9: 0x49,
  NumpadDecimal: 0x53, NumpadDivide: 0x35,
};

/** Named keys carry a character in the record even though `key` is not one char. */
const NAMED_CHARS: Record<string, number> = {
  Enter: 13,
  Tab: 9,
  Backspace: 8,
  Escape: 27,
};

/** One session's view of the requested input mode. */
export class Win32InputModeTracker {
  private enabled = false;
  private tail = '';

  get isEnabled(): boolean {
    return this.enabled;
  }

  reset(): void {
    this.enabled = false;
    this.tail = '';
  }

  /**
   * Watch a chunk of PTY output. The request can be split across chunks, so the
   * tail is carried over and re-scanned; when a chunk holds both requests the
   * later one wins.
   */
  note(chunk: string): void {
    const text = this.tail + chunk;
    const on = text.lastIndexOf(ENABLE);
    const off = text.lastIndexOf(DISABLE);
    if (on >= 0 || off >= 0) this.enabled = on > off;
    this.tail = text.slice(-(ENABLE.length - 1));
  }
}

const trackers = new Map<string, Win32InputModeTracker>();

/** The tracker for a PTY session, created on first use. */
export function win32InputMode(sessionId: string): Win32InputModeTracker {
  let tracker = trackers.get(sessionId);
  if (!tracker) {
    tracker = new Win32InputModeTracker();
    trackers.set(sessionId, tracker);
  }
  return tracker;
}

/** Forget a finished session so the registry does not grow with the app's lifetime. */
export function forgetWin32InputMode(sessionId: string): void {
  trackers.delete(sessionId);
}

/** The character the record should carry for this event. */
function unicodeChar(event: KeyboardEvent): number {
  if (event.ctrlKey && !event.altKey) {
    const vk = event.keyCode;
    // Ctrl+letter reports the control character, e.g. Ctrl+Y -> 25.
    if (vk >= 65 && vk <= 90) return vk - 64;
    if (vk === 32) return 0;
    // Ctrl+[ \ ] ^  ->  27 28 29 30
    if (vk >= 219 && vk <= 222) return vk - 192;
  }
  if (event.key.length === 1) return event.key.charCodeAt(0);
  return NAMED_CHARS[event.key] ?? 0;
}

/** `dwControlKeyState` for this event. */
function controlKeyState(event: KeyboardEvent): number {
  const right = event.location === 2;
  let state = 0;
  if (event.shiftKey) state |= SHIFT;
  if (event.ctrlKey) state |= right ? RIGHT_CTRL : LEFT_CTRL;
  if (event.altKey) state |= right ? RIGHT_ALT : LEFT_ALT;
  if (event.getModifierState?.('NumLock')) state |= NUMLOCK;
  if (event.getModifierState?.('CapsLock')) state |= CAPSLOCK;
  return state;
}

/** The `CSI Vk;Sc;Uc;Kd;Cs;Rc _` record for one key event. */
export function win32KeyRecord(event: KeyboardEvent, down: boolean): string {
  const vk = event.keyCode || 0;
  const sc = SCAN_CODES[event.code] ?? 0;
  return `\x1b[${vk};${sc};${unicodeChar(event)};${down ? 1 : 0};${controlKeyState(event)};1_`;
}

/**
 * The record to send for a key event, or null when the session never asked for
 * win32-input-mode (the caller then leaves the key to xterm.js).
 */
export function encodeWin32Key(
  sessionId: string,
  event: KeyboardEvent,
  down: boolean,
): string | null {
  const tracker = trackers.get(sessionId);
  if (!tracker?.isEnabled) return null;
  return win32KeyRecord(event, down);
}

/** The terminal surface the capture needs. */
export interface Win32KeyTerminal {
  /** Container that holds the terminal's input textarea. */
  element?: HTMLElement | undefined;
  /** Copy needs to know whether there is a selection to take. */
  hasSelection?: (() => boolean) | undefined;
}

/**
 * Copy/paste shortcuts the terminal keeps for itself, so the mode never swallows them.
 *
 * Ctrl+V always pastes. Ctrl+C copies only when there is a selection: without one it stays the
 * PTY's interrupt and must reach the encoder, otherwise the session loses its break key.
 */
function isTerminalShortcut(event: KeyboardEvent, terminal: Win32KeyTerminal): boolean {
  if (!event.ctrlKey || event.altKey || event.metaKey) return false;
  const key = event.key.toLowerCase();
  if (event.shiftKey) return key === 'c' || key === 'v';
  if (key === 'v') return true;
  return key === 'c' && Boolean(terminal.hasSelection?.());
}

/**
 * Take the keys over while a session is in win32-input-mode.
 *
 * The listener sits in the capture phase on the terminal's container, so a key
 * never reaches xterm's own handlers while the mode is on and exactly one record
 * leaves per physical key. Encoding through the custom key handler is not enough:
 * xterm.js still produces its own data for the same key, and the application then
 * sees the character twice. Nothing happens for a session that never asked for
 * the mode, and the terminal's own copy/paste shortcuts keep working.
 */
export function attachWin32KeyCapture(
  terminal: Win32KeyTerminal,
  getSessionId: () => string | null,
  write: (sessionId: string, data: string) => void,
): () => void {
  const element = terminal.element;
  if (!element) return () => {};

  const onKey = (event: KeyboardEvent): void => {
    if (isTerminalShortcut(event, terminal)) return;
    const sessionId = getSessionId();
    if (!sessionId || !win32InputMode(sessionId).isEnabled) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type === 'keypress') return; // Reported with the keydown already.
    write(sessionId, win32KeyRecord(event, event.type === 'keydown'));
  };

  element.addEventListener('keydown', onKey, true);
  element.addEventListener('keypress', onKey, true);
  element.addEventListener('keyup', onKey, true);
  return () => {
    element.removeEventListener('keydown', onKey, true);
    element.removeEventListener('keypress', onKey, true);
    element.removeEventListener('keyup', onKey, true);
  };
}
