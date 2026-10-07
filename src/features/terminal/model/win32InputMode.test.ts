import { describe, it, expect, afterEach } from 'vitest';
import {
  Win32InputModeTracker,
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
