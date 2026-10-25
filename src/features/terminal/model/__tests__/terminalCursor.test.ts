import { Terminal } from '@xterm/xterm';
import { describe, expect, it } from 'vitest';
import { applyTerminalCursorPreference } from '../terminalCursor';

function write(term: Terminal, data: string): Promise<void> {
  return new Promise(resolve => term.write(data, resolve));
}

/** xterm keeps program-requested cursor style and blink in its private modes. */
function cursorModes(term: Terminal): { cursorStyle?: string; cursorBlink?: boolean } {
  return (term as unknown as {
    _core: { coreService: { decPrivateModes: { cursorStyle?: string; cursorBlink?: boolean } } };
  })._core.coreService.decPrivateModes;
}

describe('terminal cursor preference', () => {
  it('applies the requested shape but leaves blinking to the preference', async () => {
    const term = new Terminal({ cursorBlink: false });
    applyTerminalCursorPreference(term);

    await write(term, '\x1b[5 q');
    expect(cursorModes(term).cursorStyle).toBe('bar');
    expect(cursorModes(term).cursorBlink).toBeUndefined();
    expect(term.options.cursorBlink).toBe(false);

    await write(term, '\x1b[3 q');
    expect(cursorModes(term).cursorStyle).toBe('underline');
    expect(cursorModes(term).cursorBlink).toBeUndefined();

    await write(term, '\x1b[2 q');
    expect(cursorModes(term).cursorStyle).toBe('block');
    expect(cursorModes(term).cursorBlink).toBeUndefined();

    term.dispose();
  });

  it('restores the default shape and never forces blinking', async () => {
    const term = new Terminal({ cursorBlink: true });
    applyTerminalCursorPreference(term);

    await write(term, '\x1b[5 q');
    await write(term, '\x1b[0 q');
    expect(cursorModes(term).cursorStyle).toBeUndefined();
    expect(cursorModes(term).cursorBlink).toBeUndefined();
    expect(term.options.cursorBlink).toBe(true);

    term.dispose();
  });

  it('lets a full terminal reset clear the requested shape like xterm does', async () => {
    const term = new Terminal({ cursorBlink: false });
    applyTerminalCursorPreference(term);

    await write(term, '\x1b[5 q');
    expect(cursorModes(term).cursorStyle).toBe('bar');

    term.reset();
    expect(cursorModes(term).cursorStyle).toBeUndefined();
    expect(cursorModes(term).cursorBlink).toBeUndefined();

    term.dispose();
  });
});
