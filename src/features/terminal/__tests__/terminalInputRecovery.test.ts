import { Terminal } from '@xterm/xterm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTerminalInputOptions } from '../model/terminalInput';
import { resetTerminalInputModes } from '../services/terminalInputRecovery';

const state = vi.hoisted(() => ({ term: null as Terminal | null }));
vi.mock('../services/terminalClipboard', () => ({ getPaneTerminal: () => state.term }));

const write = (term: Terminal, data: string) => new Promise<void>(resolve => term.write(data, resolve));
afterEach(() => { state.term?.dispose(); state.term = null; });

describe('terminal input recovery', () => {
  it('clears stale tracking and cursor modes while retaining native keyboard negotiation and screen text', async () => {
    const term = new Terminal({ ...getTerminalInputOptions(true) });
    state.term = term;
    const focus = vi.spyOn(term, 'focus').mockImplementation(() => {});
    await write(term, 'retained output\r\n\x1b[?1;66;1003;1004;1006;9001h');
    expect(term.modes).toMatchObject({ applicationCursorKeysMode: true, mouseTrackingMode: 'any', sendFocusMode: true, win32InputMode: true });
    resetTerminalInputModes('pane');
    await write(term, '');
    expect(term.modes).toMatchObject({ applicationCursorKeysMode: false, applicationKeypadMode: false, mouseTrackingMode: 'none', sendFocusMode: false, win32InputMode: true });
    expect(term.buffer.active.getLine(0)?.translateToString(true)).toBe('retained output');
    expect(focus).toHaveBeenCalledOnce();
  });

  it('uses the terminal parser for split native mode requests and ignores them on other platforms', async () => {
    const term = new Terminal({ ...getTerminalInputOptions(true) });
    state.term = term;
    await write(term, '\x1b[?90');
    expect(term.modes.win32InputMode).toBe(false);
    await write(term, '01h');
    expect(term.modes.win32InputMode).toBe(true);
    await write(term, '\x1b[?9001l');
    expect(term.modes.win32InputMode).toBe(false);
    term.dispose();
    const other = new Terminal({ ...getTerminalInputOptions(false) });
    state.term = other;
    await write(other, '\x1b[?9001h');
    expect(other.modes.win32InputMode).toBe(false);
  });

  it('does nothing after a terminal is closed', () => {
    expect(() => resetTerminalInputModes('closed')).not.toThrow();
  });
});
