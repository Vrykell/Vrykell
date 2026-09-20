import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSessionStore, type Tab } from '@features/workspace';
import { useTerminalStore } from '@features/terminal';
import { leaf } from '@features/workspace/model/windowLayout';
import { useChatPaneContext } from '@features/chat/hooks/useChatPaneContext';

describe('useChatPaneContext', () => {
  const sessionSnapshot = useSessionStore.getState();
  const terminalSnapshot = useTerminalStore.getState();

  afterEach(() => {
    act(() => {
      useSessionStore.setState(sessionSnapshot, true);
      useTerminalStore.setState(terminalSnapshot, true);
    });
  });

  it('resolves the focused pane and exposes shell/cwd labels for chat', () => {
    const paneId = 'tab-1#0';
    const tab: Tab = {
      id: 'tab-1', title: '开发会话', kind: 'session',
      layout: leaf({ id: paneId, kind: 'local', shellType: 'bash', cwd: '/workspace' }),
    };
    act(() => {
      useSessionStore.setState({ tabs: [tab], activeId: tab.id, terminalCwds: {} });
      useTerminalStore.setState({ focusedPaneId: paneId, sessions: { [paneId]: 'pty-1' } });
    });

    const { result } = renderHook(() => useChatPaneContext());

    expect(result.current.isSession).toBe(true);
    expect(result.current.targetPane).toBe(paneId);
    expect(result.current.targetInfo).toEqual({ shell: 'Bash', cwd: '/workspace' });
    expect(result.current.targetConnected).toBe(true);
    expect(result.current.targetFocused).toBe(true);
    expect(result.current.paneLabel(paneId)).toBe('Bash · workspace');
  });

  it('keeps legacy messages in the window group and marks fallback focus correctly', () => {
    const paneId = 'tab-2#0';
    const tab: Tab = {
      id: 'tab-2', title: '开发会话', kind: 'session',
      layout: leaf({ id: paneId, kind: 'local', shellType: 'bash' }),
    };
    act(() => {
      useSessionStore.setState({ tabs: [tab], activeId: tab.id, terminalCwds: {} });
      useTerminalStore.setState({ focusedPaneId: 'missing-pane', sessions: {} });
    });

    const { result } = renderHook(() => useChatPaneContext());

    expect(result.current.targetPane).toBe(paneId);
    expect(result.current.targetFocused).toBe(false);
    expect(result.current.paneLabel()).toBe('本窗口');
  });
});
