import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
invokeMock.mockResolvedValue(undefined);
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { useTerminalStore, registerTerminal, unregisterTerminal, getRecentOutput, getFocusedTerminalId } from '@features/terminal/stores/terminal';
import { useWorkspaceStore } from '@features/workspace/stores/workspace';
import { terminalCommandPayload } from '../services/commandSubmission';

const initialTerm = useTerminalStore.getState();
const initialWs = useWorkspaceStore.getState();

describe('terminal store', () => {
  it.each([
    ['cmd', 'echo first\necho second\n'],
    ['bash', 'eval "$(printf \'%s\\n\' \'echo first\' \'echo second\')"\n'],
  ])('serializes scripts with the actual %s process instead of an unspecified layout preference', (shell, expected) => {
    const paneId = `${useWorkspaceStore.getState().activeId}#0`;
    useTerminalStore.setState({ shellTypes: { [paneId]: shell } });
    expect(terminalCommandPayload(paneId, 'echo first\necho second')).toBe(expected);
  });
  beforeEach(() => {
    invokeMock.mockClear();
    useTerminalStore.setState(initialTerm, true);
    useWorkspaceStore.setState(initialWs, true);
    // Simulate an active tab after startup (the store no longer ships an initial tab)
    useWorkspaceStore.getState().addTab({});
  });

  it('getFocusedTerminalId returns the first terminal of the active window by default', () => {
    const activeId = useWorkspaceStore.getState().activeId;
    expect(getFocusedTerminalId()).toBe(`${activeId}#0`);
  });

  it('clears a stopped session and queued input while retaining its scene and dimensions', () => {
    useTerminalStore.setState({ sessions: { p: 'old', other: 'live' }, pendingCommands: { p: ['secret'], other: ['ls'] }, scenes: { p: 'classic' }, dims: { p: { cols: 80, rows: 24 } } });
    useTerminalStore.getState().clearSession('p', 'old');
    expect(useTerminalStore.getState().sessions).toEqual({ other: 'live' });
    expect(useTerminalStore.getState().pendingCommands).toEqual({ other: ['ls'] });
    expect(useTerminalStore.getState().scenes.p).toBe('classic');
    expect(useTerminalStore.getState().dims.p).toEqual({ cols: 80, rows: 24 });
  });

  it('does not clear a replacement session when an older process exits', () => {
    useTerminalStore.setState({ sessions: { p: 'new' } });
    useTerminalStore.getState().clearSession('p', 'old');
    expect(useTerminalStore.getState().sessions.p).toBe('new');
  });

  it('runInTerminal writes to the focused terminal session and appends a newline', () => {
    const termId = getFocusedTerminalId();
    useTerminalStore.getState().setSession(termId, 's1');
    useTerminalStore.getState().runInTerminal('ls -la');
    expect(invokeMock).toHaveBeenCalledWith('pty_write', { id: 's1', data: 'ls -la\n' });
  });

  it('expands the terminal panel automatically and writes nothing when there is no session', () => {
    invokeMock.mockClear(); // addTab in beforeEach records a create_session call
    useTerminalStore.setState({ visible: false });
    useTerminalStore.getState().runInTerminal('ls');
    expect(useTerminalStore.getState().visible).toBe(true);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('queues commands while the PTY is not ready and flushes them once the session is established', () => {
    const termId = getFocusedTerminalId();
    useTerminalStore.getState().queueCommand(termId, 'echo ready');
    expect(useTerminalStore.getState().pendingCommands[termId]).toEqual(['echo ready']);

    useTerminalStore.getState().setSession(termId, 's1');

    expect(invokeMock).toHaveBeenCalledWith('pty_write', { id: 's1', data: 'echo ready\n' });
    expect(useTerminalStore.getState().pendingCommands[termId]).toBeUndefined();
  });

  it('getRecentOutput reads the focused terminal buffer and trims trailing blank lines', () => {
    const termId = getFocusedTerminalId();
    const fakeLines = ['$ ls', 'file1  file2', '', ''];
    const fakeTerm = {
      buffer: {
        active: {
          baseY: 0,
          cursorY: 3,
          getLine: (i: number) => ({ translateToString: () => fakeLines[i] }),
        },
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerTerminal(termId, fakeTerm as any);
    expect(getRecentOutput(10)).toBe('$ ls\nfile1  file2');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    unregisterTerminal(termId, fakeTerm as any);
    expect(getRecentOutput(10)).toBe('');
  });
});
