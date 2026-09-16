import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSessionStore, type Tab } from '@entities/session';
import { useBlockStore, useTerminalStore } from '@entities/terminal';
import { leaf } from '@features/workspace/model/windowLayout';
import { useTerminalInputContext } from '@features/terminal/hooks/useTerminalInputContext';

describe('useTerminalInputContext', () => {
  const sessionSnapshot = useSessionStore.getState();
  const terminalSnapshot = useTerminalStore.getState();
  const blockSnapshot = useBlockStore.getState();

  afterEach(() => {
    act(() => {
      useSessionStore.setState(sessionSnapshot, true);
      useTerminalStore.setState(terminalSnapshot, true);
      useBlockStore.setState(blockSnapshot, true);
    });
  });

  it('aggregates pane session metadata and runtime state', () => {
    const paneId = 'tab-1#0';
    const tab: Tab = {
      id: 'tab-1',
      title: '工作区',
      kind: 'session',
      layout: leaf({ id: paneId, kind: 'local', shellType: 'bash', cwd: 'C:/workspace' }),
    };
    act(() => {
      useSessionStore.setState({ tabs: [tab], activeId: tab.id, terminalCwds: { [paneId]: 'C:/workspace/src' } });
      useTerminalStore.setState({
        sessions: { [paneId]: 'pty-1' },
        focusedPaneId: paneId,
        scenes: { [paneId]: 'classic' },
        pendingInput: 'git status',
      });
    });

    const { result } = renderHook(() => useTerminalInputContext({ paneId }));

    expect(result.current.isFocused).toBe(true);
    expect(result.current.hasSession).toBe(true);
    expect(result.current.tabCwd).toBe('C:/workspace/src');
    expect(result.current.terminalLabel).toBe('Bash');
    expect(result.current.pendingInput).toBe('git status');
    expect(result.current.visible).toBe(true);
  });

  it('hides input for alt-screen and long-running panes', () => {
    const paneId = 'tab-2#0';
    const tab: Tab = {
      id: 'tab-2',
      title: '工作区',
      kind: 'session',
      layout: leaf({ id: paneId, kind: 'local' }),
    };
    act(() => {
      useSessionStore.setState({ tabs: [tab], activeId: tab.id, terminalCwds: {} });
      useTerminalStore.setState({ scenes: { [paneId]: 'altScreen' }, focusedPaneId: paneId, sessions: {} });
    });

    const { result, rerender } = renderHook(
      ({ isLongRunning }) => useTerminalInputContext({ paneId, isLongRunning }),
      { initialProps: { isLongRunning: false } },
    );
    expect(result.current.visible).toBe(false);

    act(() => useTerminalStore.setState({ scenes: { [paneId]: 'classic' } }));
    rerender({ isLongRunning: true });
    expect(result.current.visible).toBe(false);
  });
});
