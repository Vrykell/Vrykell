import { Terminal } from '@xterm/xterm';
import { describe, expect, it } from 'vitest';
import { applyTerminalCursorPreference } from '../terminalCursor';

function write(term: Terminal, data: string): Promise<void> {
  return new Promise(resolve => term.write(data, resolve));
}

/** xterm keeps program-requested cursor blink in its private mode, ahead of the option. */
function requestedBlink(term: Terminal): boolean | undefined {
  const core = (term as unknown as {
    _core: { coreService: { decPrivateModes: { cursorBlink?: boolean } } };
  })._core;
  return core.coreService.decPrivateModes.cursorBlink;
}

describe('terminal cursor preference', () => {
  it('applies the requested shape but leaves blinking to the preference', async () => {
    const term = new Terminal({ cursorBlink: false });
    applyTerminalCursorPreference(term);

    await write(term, '\x1b[5 q');
    expect(term.options.cursorStyle).toBe('bar');
    expect(term.options.cursorBlink).toBe(false);
    expect(requestedBlink(term)).toBeUndefined();

    await write(term, '\x1b[3 q');
    expect(term.options.cursorStyle).toBe('underline');
    expect(requestedBlink(term)).toBeUndefined();

    await write(term, '\x1b[2 q');
    expect(term.options.cursorStyle).toBe('block');
    expect(requestedBlink(term)).toBeUndefined();

    term.dispose();
  });

  it('restores the default block cursor and never forces blinking', async () => {
    const term = new Terminal({ cursorBlink: true });
    applyTerminalCursorPreference(term);

    await write(term, '\x1b[5 q');
    await write(term, '\x1b[0 q');
    expect(term.options.cursorStyle).toBe('block');
    expect(term.options.cursorBlink).toBe(true);
    expect(requestedBlink(term)).toBeUndefined();

    term.dispose();
  });
});
