import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useSessionStore, type Tab } from '@features/workspace';
import { useTerminalStore } from '@features/terminal';
import { leaf } from '@features/workspace/model/windowLayout';
import { usePanelTerminal } from '../hooks/usePanelTerminal';
import { usePanelTerminalStore } from '../stores/panelTerminal';

const session = (id: string, paneId: string, cwd: string): Tab => ({
  id,
  title: id.toUpperCase(),
  kind: 'session',
  layout: leaf({ id: paneId, kind: 'local', cwd }),
});

describe('usePanelTerminal', () => {
  const sessionSnapshot = useSessionStore.getState();
  const terminalSnapshot = useTerminalStore.getState();
  const bindingsSnapshot = usePanelTerminalStore.getState();

  beforeEach(() => {
    usePanelTerminalStore.setState({ bindings: {} });
    useSessionStore.setState({
      tabs: [session('a', 'a#0', '/a'), session('b', 'b#0', '/b')],
      activeId: 'a',
      terminalCwds: { 'a#0': '/a', 'b#0': '/b' },
    });
    useTerminalStore.setState({
      focusedPaneId: 'a#0',
      sessions: { 'a#0': 'session-a', 'b#0': 'session-b' },
      shellTypes: { 'a#0': 'bash', 'b#0': 'zsh' },
    });
  });

  afterEach(() => {
    usePanelTerminalStore.setState(bindingsSnapshot, true);
    useSessionStore.setState(sessionSnapshot, true);
    useTerminalStore.setState(terminalSnapshot, true);
  });

  it('follows the focused terminal until a live terminal is explicitly bound', () => {
    const { result } = renderHook(() => usePanelTerminal('files'));

    expect(result.current.options.map(option => option.paneId)).toEqual(['a#0', 'b#0']);
    expect(result.current).toMatchObject({ isBound: false, paneId: 'a#0', cwd: '/a' });

    act(() => result.current.bind('b#0'));

    expect(result.current).toMatchObject({ isBound: true, paneId: 'b#0', cwd: '/b' });
    expect(result.current.boundPaneId).toBe('b#0');
  });

  it('ignores focus and editor changes while the bound terminal is live', () => {
    const { result } = renderHook(() => usePanelTerminal('files'));
    act(() => result.current.bind('b#0'));

    act(() => {
      useSessionStore.setState({ activeId: 'b' });
      useTerminalStore.setState({ focusedPaneId: 'b#0' });
      useSessionStore.setState({ activeId: 'a' });
      useTerminalStore.setState({ focusedPaneId: 'a#0' });
      useSessionStore.setState(state => ({ terminalCwds: { ...state.terminalCwds, 'b#0': '/b/next' } }));
    });

    expect(result.current).toMatchObject({ isBound: true, paneId: 'b#0', cwd: '/b/next' });
  });

  it('drops a binding whose terminal closed and follows focus again', async () => {
    const { result } = renderHook(() => usePanelTerminal('git'));
    act(() => result.current.bind('b#0'));

    act(() => {
      useSessionStore.setState({ tabs: [session('a', 'a#0', '/a')] });
      useTerminalStore.setState({
        focusedPaneId: 'a#0',
        sessions: { 'a#0': 'session-a' },
      });
    });

    await waitFor(() => expect(result.current.isBound).toBe(false));
    expect(result.current).toMatchObject({ paneId: 'a#0', cwd: '/a' });
    expect(usePanelTerminalStore.getState().bindings.git).toBeUndefined();
  });

  it('lists only terminals with a live session', () => {
    useTerminalStore.setState({ sessions: { 'a#0': 'session-a' } });
    const { result } = renderHook(() => usePanelTerminal('command-history'));
    expect(result.current.options.map(option => option.paneId)).toEqual(['a#0']);
  });
});
