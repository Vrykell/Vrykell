import { Terminal } from '@xterm/xterm';
import { describe, expect, it, vi } from 'vitest';
import { applyTerminalCursorPreference } from '../terminalCursor';
import { terminalDebug } from '../../services/terminalDebug';

vi.mock('../../services/terminalDebug', () => ({ terminalDebug: vi.fn(), isTerminalInputTraceEnabled: () => true }));

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
  it('observes cursor visibility across output chunks without changing terminal modes', async () => {
    const term = new Terminal({ cursorBlink: false });
    const core = (term as unknown as { _core: { coreService: { isCursorHidden: boolean } } })._core.coreService;
    const renders: Array<() => void> = [];
    const onRender: Terminal['onRender'] = callback => {
      renders.push(() => callback({ start: 0, end: 0 }));
      return { dispose() {} };
    };
    Object.defineProperty(term, 'onRender', { value: onRender });
    vi.mocked(terminalDebug).mockClear();
    applyTerminalCursorPreference(term, 'pane-test');

    await write(term, '\x1b[?25;2004l');
    expect(core.isCursorHidden).toBe(true);
    expect(term.modes.bracketedPasteMode).toBe(false);
    renders.forEach(render => render());
    expect(terminalDebug).toHaveBeenCalledWith('terminal-cursor-visibility-render', expect.objectContaining({
      paneId: 'pane-test', hidden: true, blink: false,
    }));

    await write(term, 'echo-test\x1b[?25;2004h');
    expect(core.isCursorHidden).toBe(false);
    expect(term.modes.bracketedPasteMode).toBe(true);
    renders.forEach(render => render());
    expect(terminalDebug).toHaveBeenCalledWith('terminal-cursor-visibility-request', { paneId: 'pane-test', visible: false });
    expect(terminalDebug).toHaveBeenCalledWith('terminal-cursor-visibility-request', { paneId: 'pane-test', visible: true });
    expect(terminalDebug).toHaveBeenCalledWith('terminal-cursor-visibility-render', expect.objectContaining({ hidden: false }));
    expect(JSON.stringify(vi.mocked(terminalDebug).mock.calls)).not.toContain('echo-test');
    const calls = vi.mocked(terminalDebug).mock.calls.length;
    renders.forEach(render => render());
    expect(vi.mocked(terminalDebug).mock.calls).toHaveLength(calls);
    term.dispose();
  });

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
