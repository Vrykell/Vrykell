import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import {
  isTerminalDebugEnabled,
  setTerminalDebugEnabled,
  terminalDebug,
} from '@features/terminal/services/terminalDebug';

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
  setTerminalDebugEnabled(false);
  vi.restoreAllMocks();
});

describe('terminal diagnostics switch', () => {
  it('persists the switch and syncs the backend', () => {
    expect(isTerminalDebugEnabled()).toBe(false);
    setTerminalDebugEnabled(true);
    expect(isTerminalDebugEnabled()).toBe(true);
    expect(localStorage.getItem('vrykell-terminal-debug')).toBe('1');
    expect(invokeMock).toHaveBeenLastCalledWith('terminal_debug_set', { enabled: true });
  });

  it('does not emit debug output while disabled', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    terminalDebug('ignored', { value: 1 });
    expect(spy).not.toHaveBeenCalled();
  });

  it('emits structured debug output while enabled', () => {
    setTerminalDebugEnabled(true);
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    terminalDebug('command-done', { exitCode: 128 });
    expect(spy).toHaveBeenCalledWith('[terminal-debug] command-done', { exitCode: 128 });
  });
});
