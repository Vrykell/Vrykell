import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSessionStore, type Tab } from '@features/workspace';
import { useTerminalStore } from '@features/terminal';
import { leaf, splitLeaf } from '@features/workspace/model/windowLayout';
import { useActiveWorkspace } from '@features/workspace/hooks/useActiveWorkspace';

describe('useActiveWorkspace', () => {
  const sessionSnapshot = useSessionStore.getState();
  const terminalSnapshot = useTerminalStore.getState();

  afterEach(() => {
    useSessionStore.setState(sessionSnapshot, true);
    useTerminalStore.setState(terminalSnapshot, true);
  });

  it('returns the active pane and its runtime cwd', () => {
    const tab: Tab = {
      id: 'tab-1',
      title: '工作区',
      kind: 'session',
      layout: leaf({ id: 'tab-1#0', kind: 'local', cwd: 'C:/workspace' }),
    };
    useSessionStore.setState({
      tabs: [tab],
      activeId: tab.id,
      terminalCwds: { 'tab-1#0': 'C:/workspace/src' },
    });
    useTerminalStore.setState({
      focusedPaneId: 'tab-1#0',
      sessions: { 'tab-1#0': 'pty-1' },
    });

    const { result } = renderHook(() => useActiveWorkspace());

    expect(result.current.activeTab?.id).toBe('tab-1');
    expect(result.current.focusedPaneId).toBe('tab-1#0');
    expect(result.current.focusedSpec?.cwd).toBe('C:/workspace');
    expect(result.current.activeCwd).toBe('C:/workspace/src');
  });

  it('falls back to the first pane when the focused pane is stale', () => {
    const firstPane = { id: 'tab-2#0', kind: 'local' as const };
    const secondPane = { id: 'tab-2#1', kind: 'local' as const };
    const tab: Tab = {
      id: 'tab-2',
      title: '分屏工作区',
      kind: 'session',
      layout: splitLeaf(leaf(firstPane), firstPane.id, 'row', 'second', secondPane),
    };
    useSessionStore.setState({ tabs: [tab], activeId: tab.id, terminalCwds: {} });
    useTerminalStore.setState({ focusedPaneId: 'missing-pane', sessions: {} });

    const { result } = renderHook(() => useActiveWorkspace());

    expect(result.current.focusedPaneId).toBe(firstPane.id);
    expect(result.current.focusedSpec?.id).toBe(firstPane.id);
  });
});
