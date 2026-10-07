import { describe, it, expect, afterEach } from 'vitest';
import {
  Win32InputModeTracker,
  attachWin32KeyCapture,
  encodeWin32Key,
  forgetWin32InputMode,
  win32InputMode,
} from '@features/terminal/model/win32InputMode';

interface KeyInit {
  key: string;
  code?: string;
  keyCode?: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  location?: number;
  numLock?: boolean;
  capsLock?: boolean;
}

function key(init: KeyInit): KeyboardEvent {
  return {
    key: init.key,
    code: init.code ?? '',
    keyCode: init.keyCode ?? 0,
    shiftKey: init.shiftKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    altKey: init.altKey ?? false,
    location: init.location ?? 0,
    getModifierState: (name: string) =>
      (name === 'NumLock' && init.numLock === true) || (name === 'CapsLock' && init.capsLock === true),
  } as unknown as KeyboardEvent;
}

afterEach(() => {
  forgetWin32InputMode('s1');
});

describe('Win32InputModeTracker', () => {
  it('stays off until a session requests the mode', () => {
    const tracker = new Win32InputModeTracker();
    tracker.note('plain output\r\n');
    expect(tracker.isEnabled).toBe(false);
  });

  it('enables and disables on the request sequences', () => {
    const tracker = new Win32InputModeTracker();
    tracker.note('\x1b[?9001h');
    expect(tracker.isEnabled).toBe(true);
    tracker.note('\x1b[?9001l');
    expect(tracker.isEnabled).toBe(false);
  });

  it('recognises a request split across output chunks', () => {
    const tracker = new Win32InputModeTracker();
    tracker.note('before\x1b[?90');
    expect(tracker.isEnabled).toBe(false);
    tracker.note('01hafter');
    expect(tracker.isEnabled).toBe(true);
  });

  it('lets the later request win when a chunk holds both', () => {
    const tracker = new Win32InputModeTracker();
    tracker.note('\x1b[?9001h\x1b[?9001l');
    expect(tracker.isEnabled).toBe(false);
    tracker.note('\x1b[?9001l\x1b[?9001h');
    expect(tracker.isEnabled).toBe(true);
  });
});

describe('encodeWin32Key', () => {
  it('leaves keys alone while the session has not asked for the mode', () => {
    expect(encodeWin32Key('s1', key({ key: 'a', code: 'KeyA', keyCode: 65 }), true)).toBeNull();
  });

  it('encodes a plain character', () => {
    win32InputMode('s1').note('\x1b[?9001h');
    expect(encodeWin32Key('s1', key({ key: 'a', code: 'KeyA', keyCode: 65 }), true))
      .toBe('\x1b[65;30;97;1;0;1_');
  });

  it('encodes shifted and controlled keys with their state', () => {
    win32InputMode('s1').note('\x1b[?9001h');
    expect(encodeWin32Key('s1', key({ key: 'A', code: 'KeyA', keyCode: 65, shiftKey: true }), true))
      .toBe('\x1b[65;30;65;1;16;1_');
    expect(encodeWin32Key('s1', key({ key: 'y', code: 'KeyY', keyCode: 89, ctrlKey: true }), true))
      .toBe('\x1b[89;21;25;1;8;1_');
    expect(encodeWin32Key('s1', key({ key: 'F1', code: 'F1', keyCode: 112, ctrlKey: true }), true))
      .toBe('\x1b[112;59;0;1;8;1_');
  });

  it('encodes named keys and key releases', () => {
    win32InputMode('s1').note('\x1b[?9001h');
    expect(encodeWin32Key('s1', key({ key: 'Enter', code: 'Enter', keyCode: 13 }), true))
      .toBe('\x1b[13;28;13;1;0;1_');
    expect(encodeWin32Key('s1', key({ key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 }), true))
      .toBe('\x1b[38;72;0;1;0;1_');
    expect(encodeWin32Key('s1', key({ key: 'a', code: 'KeyA', keyCode: 65 }), false))
      .toBe('\x1b[65;30;97;0;0;1_');
  });

  it('reports the lock keys the record carries', () => {
    win32InputMode('s1').note('\x1b[?9001h');
    expect(encodeWin32Key('s1', key({ key: 'a', code: 'KeyA', keyCode: 65, numLock: true }), true))
      .toBe('\x1b[65;30;97;1;32;1_');
    expect(encodeWin32Key('s1', key({ key: 'a', code: 'KeyA', keyCode: 65, capsLock: true }), true))
      .toBe('\x1b[65;30;97;1;128;1_');
  });

  it('forgets a finished session', () => {
    win32InputMode('s1').note('\x1b[?9001h');
    forgetWin32InputMode('s1');
    expect(encodeWin32Key('s1', key({ key: 'a', code: 'KeyA', keyCode: 65 }), true)).toBeNull();
  });
});

// ── the capture the terminals install ──
//
// Invariant under test: one physical key produces exactly one write, in the
// encoding the session asked for, and nothing at all when it did not ask. xterm
// keeps its own listeners on the textarea, so the capture sits on the container
// and must stop the key before it gets there.

const RECORD = /^\x1b\[\d+;\d+;\d+;[01];\d+;\d+_$/;

/** Real DOM events; the capture only exists on the DOM path. */
function realKey(type: string, init: KeyInit): KeyboardEvent {
  const event = new KeyboardEvent(type, {
    key: init.key,
    code: init.code ?? '',
    shiftKey: init.shiftKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    altKey: init.altKey ?? false,
    bubbles: true,
    cancelable: true,
    modifierNumLock: init.numLock ?? false,
    modifierCapsLock: init.capsLock ?? false,
  });
  Object.defineProperty(event, 'keyCode', { get: () => init.keyCode ?? 0 });
  Object.defineProperty(event, 'location', { get: () => init.location ?? 0 });
  return event;
}

interface Wired {
  container: HTMLElement;
  textarea: HTMLTextAreaElement;
  writes: string[];
  /** Fires when a key reaches the element xterm listens on. */
  reachedTextarea: () => number;
  detach: () => void;
}

function wire(sessionId: () => string | null): Wired {
  const container = document.createElement('div');
  const textarea = document.createElement('textarea');
  container.appendChild(textarea);
  document.body.appendChild(container);
  const writes: string[] = [];
  let reached = 0;
  textarea.addEventListener('keydown', () => { reached++; });
  textarea.addEventListener('keypress', () => { reached++; });
  const detach = attachWin32KeyCapture({ element: container }, sessionId, (_id, data) => {
    writes.push(data);
  });
  return { container, textarea, writes, reachedTextarea: () => reached, detach };
}

function press(w: Wired, type: string, init: KeyInit): KeyboardEvent {
  const event = realKey(type, init);
  w.textarea.dispatchEvent(event);
  return event;
}

const KEY_A: KeyInit = { key: 'a', code: 'KeyA', keyCode: 65 };

describe('attachWin32KeyCapture', () => {
  it('writes exactly one record for a key press, and xterm never sees the key', () => {
    const w = wire(() => 's1');
    win32InputMode('s1').note('\x1b[?9001h');

    press(w, 'keydown', KEY_A);
    expect(w.writes).toEqual(['\x1b[65;30;97;1;0;1_']);

    // A keydown is followed by a keypress; it must not add a second input.
    press(w, 'keypress', KEY_A);
    expect(w.writes).toEqual(['\x1b[65;30;97;1;0;1_']);

    press(w, 'keyup', KEY_A);
    expect(w.writes).toEqual(['\x1b[65;30;97;1;0;1_', '\x1b[65;30;97;0;0;1_']);
    expect(w.reachedTextarea()).toBe(0);
    w.detach();
  });

  it('leaves the key to xterm while the session has not asked for the mode', () => {
    const w = wire(() => 's1');
    const event = press(w, 'keydown', KEY_A);
    expect(w.writes).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
    expect(w.reachedTextarea()).toBe(1);
    w.detach();
  });

  it('goes back to xterm when the session turns the mode off again', () => {
    const w = wire(() => 's1');
    win32InputMode('s1').note('\x1b[?9001h');
    press(w, 'keydown', KEY_A);
    win32InputMode('s1').note('\x1b[?9001l');
    press(w, 'keydown', { key: 'b', code: 'KeyB', keyCode: 66 });
    expect(w.writes).toEqual(['\x1b[65;30;97;1;0;1_']);
    w.detach();
  });

  it('only takes over the keys of the session that asked', () => {
    const w = wire(() => 's2');
    win32InputMode('s1').note('\x1b[?9001h');
    press(w, 'keydown', KEY_A);
    expect(w.writes).toEqual([]);
    w.detach();
  });

  it('keeps the shortcuts the terminal owns', () => {
    const w = wire(() => 's1');
    win32InputMode('s1').note('\x1b[?9001h');
    const paste = press(w, 'keydown', { key: 'v', code: 'KeyV', keyCode: 86, ctrlKey: true, shiftKey: true });
    expect(w.writes).toEqual([]);
    expect(paste.defaultPrevented).toBe(false);
    w.detach();
  });

  it('leaves the copy/paste shortcuts to the terminal', () => {
    const w = wire(() => 's1');
    win32InputMode('s1').note('\x1b[?9001h');
    const before = w.writes.length;
    // Ctrl+V 粘贴、Ctrl+Shift+C 复制：都给终端，不进记录
    press(w, 'keydown', { key: 'v', code: 'KeyV', keyCode: 86, ctrlKey: true });
    press(w, 'keydown', { key: 'c', code: 'KeyC', keyCode: 67, ctrlKey: true, shiftKey: true });
    expect(w.writes.length).toBe(before);

    // 没有选区时 Ctrl+C 仍是中断键，必须编码（否则会话丢了 break）
    press(w, 'keydown', { key: 'c', code: 'KeyC', keyCode: 67, ctrlKey: true });
    expect(w.writes.length).toBe(before + 1);
    w.detach();
  });

  it('has nothing to take over without a container', () => {
    const writes: string[] = [];
    const detach = attachWin32KeyCapture({ element: undefined }, () => 's1', (_id, data) => {
      writes.push(data);
    });
    win32InputMode('s1').note('\x1b[?9001h');
    expect(writes).toEqual([]);
    detach();
  });

  it('writes exactly one record for every key of the keyboard', () => {
    const w = wire(() => 's1');
    win32InputMode('s1').note('\x1b[?9001h');
    const table: KeyInit[] = [
      { key: 'a', code: 'KeyA', keyCode: 65 },
      { key: 'z', code: 'KeyZ', keyCode: 90 },
      { key: 'A', code: 'KeyA', keyCode: 65, shiftKey: true },
      { key: '1', code: 'Digit1', keyCode: 49 },
      { key: '!', code: 'Digit1', keyCode: 49, shiftKey: true },
      { key: '-', code: 'Minus', keyCode: 189 },
      { key: ' ', code: 'Space', keyCode: 32 },
      { key: 'Enter', code: 'Enter', keyCode: 13 },
      { key: 'Escape', code: 'Escape', keyCode: 27 },
      { key: 'Tab', code: 'Tab', keyCode: 9 },
      { key: 'Backspace', code: 'Backspace', keyCode: 8 },
      { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
      { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
      { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
      { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
      { key: 'Home', code: 'Home', keyCode: 36 },
      { key: 'End', code: 'End', keyCode: 35 },
      { key: 'PageUp', code: 'PageUp', keyCode: 33 },
      { key: 'PageDown', code: 'PageDown', keyCode: 34 },
      { key: 'Insert', code: 'Insert', keyCode: 45 },
      { key: 'Delete', code: 'Delete', keyCode: 46 },
      { key: 'F1', code: 'F1', keyCode: 112 },
      { key: 'F12', code: 'F12', keyCode: 123 },
      { key: 'Shift', code: 'ShiftLeft', keyCode: 16, shiftKey: true },
      { key: 'Control', code: 'ControlLeft', keyCode: 17, ctrlKey: true },
      { key: 'Alt', code: 'AltLeft', keyCode: 18, altKey: true },
      { key: 'a', code: 'KeyA', keyCode: 65, ctrlKey: true },
      { key: '5', code: 'Numpad5', keyCode: 101 },
      { key: '你好', code: '', keyCode: 0 },
    ];
    for (const init of table) {
      const before = w.writes.length;
      press(w, 'keydown', init);
      press(w, 'keypress', init);
      press(w, 'keyup', init);
      const written = w.writes.slice(before);
      const fields = (record: string): string[] => record.slice(2, -1).split(';');
      expect(written, JSON.stringify(init)).toHaveLength(2); // the press and its release, nothing more
      expect(written[0], JSON.stringify(init)).toMatch(RECORD);
      expect(fields(written[0]!)[0], JSON.stringify(init)).toBe(String(init.keyCode ?? 0));
      expect(fields(written[0]!)[3], JSON.stringify(init)).toBe('1'); // key down
      expect(fields(written[0]!)[5], JSON.stringify(init)).toBe('1'); // one repeat
      expect(fields(written[1]!)[3], JSON.stringify(init)).toBe('0'); // key up
      expect(fields(written[1]!)[1], JSON.stringify(init)).toBe(fields(written[0]!)[1]);
    }
    expect(w.reachedTextarea()).toBe(0);
    w.detach();
  });

  it('never writes twice, whatever the key is', () => {
    const w = wire(() => 's1');
    win32InputMode('s1').note('\x1b[?9001h');
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-=/\\.,;[]`\' ';
    const keys = ['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape', 'Backspace', 'F5', 'Home', 'End', 'Delete'];
    for (let i = 0; i < 400; i++) {
      const ch = chars[i % chars.length]!;
      if (i % 3 === 0) {
        const before = w.writes.length;
        const init: KeyInit = { key: keys[i % keys.length]!, code: '', keyCode: 30 + (i % 60) };
        press(w, 'keydown', init);
        expect(w.writes.length - before, `i=${i} ${JSON.stringify(init)}`).toBe(1);
      } else {
        const before = w.writes.length;
        const ctrl = i % 7 === 0;
        const init: KeyInit = {
          key: ch, code: '', keyCode: ch.charCodeAt(0),
          shiftKey: i % 5 === 0, ctrlKey: ctrl, altKey: i % 11 === 0,
        };
        press(w, 'keydown', init);
        press(w, 'keypress', init);
        // 复制/粘贴归终端：Ctrl+V 不产生记录。Ctrl+C 只有「有选区」才是复制，
        // 这个假终端没有选区，所以它仍要编码成中断（选区路径由 e2e 覆盖）。
        const pasteShortcut = ctrl && !init.altKey && ch.toLowerCase() === 'v';
        expect(w.writes.length - before, `i=${i} ${JSON.stringify(init)}`).toBe(pasteShortcut ? 0 : 1);
      }
    }
    w.detach();
  });
});
