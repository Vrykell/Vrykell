import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSessionStore, type Tab } from '@features/workspace';
import { useTerminalStore } from '@features/terminal';
import { useUiStore } from '@features/workspace';
import { countLeaves, leaf, leaves, splitLeaf } from '@features/workspace/model/windowLayout';
import { useTerminalLayoutActions } from '@features/terminal/hooks/useTerminalLayoutActions';

describe('useTerminalLayoutActions', () => {
  const sessionSnapshot = useSessionStore.getState();
  const terminalSnapshot = useTerminalStore.getState();
  const uiSnapshot = useUiStore.getState();

  afterEach(() => {
    useSessionStore.setState(sessionSnapshot, true);
    useTerminalStore.setState(terminalSnapshot, true);
    useUiStore.setState(uiSnapshot, true);
  });

  it('commits a split using the source terminal mode and focuses the new pane', () => {
    const source = { id: 'window-1#0', kind: 'local' as const, shellType: 'bash', openMode: 'block' as const };
    const tab: Tab = { id: 'window-1', title: '测试窗口', kind: 'session', layout: leaf(source) };
    useSessionStore.setState({ tabs: [tab], activeId: tab.id });
    useTerminalStore.setState({ focusedPaneId: source.id });
    useUiStore.setState({ splitPlacement: { open: true, spec: null } });

    const { result } = renderHook(() => useTerminalLayoutActions({ windowId: tab.id, layout: tab.layout }));
    const target = result.current.placementTargets[0];
    expect(target).toBeDefined();

    act(() => result.current.commitPlacement(target!));

    const nextTab = useSessionStore.getState().tabs[0];
    expect(nextTab?.kind).toBe('session');
    if (nextTab?.kind !== 'session') return;
    expect(countLeaves(nextTab.layout)).toBe(2);
    expect(leaves(nextTab.layout).find((item) => item.id === 'window-1#1')?.openMode).toBe('block');
    expect(useTerminalStore.getState().focusedPaneId).toBe('window-1#1');
    expect(useUiStore.getState().splitPlacement.open).toBe(false);
  });

  it('moves a pane, updates the ratio, and closes the placement state', () => {
    const first = { id: 'window-2#0', kind: 'local' as const };
    const second = { id: 'window-2#1', kind: 'local' as const };
    const layout = splitLeaf(leaf(first), first.id, 'row', 'second', second);
    const tab: Tab = { id: 'window-2', title: '测试窗口', kind: 'session', layout };
    useSessionStore.setState({ tabs: [tab], activeId: tab.id });
    useTerminalStore.setState({ focusedPaneId: second.id });
    useUiStore.setState({ movePlacement: { open: true, terminalId: second.id } });

    const { result, rerender } = renderHook(
      ({ currentLayout }) => useTerminalLayoutActions({ windowId: tab.id, layout: currentLayout }),
      { initialProps: { currentLayout: layout } },
    );
    const target = result.current.movePlacementTargets[0];
    expect(target?.leafId).toBe(first.id);

    act(() => result.current.completeMove(target!));
    const movedTab = useSessionStore.getState().tabs[0];
    expect(movedTab?.kind).toBe('session');
    if (movedTab?.kind !== 'session') return;
    expect(countLeaves(movedTab.layout)).toBe(2);
    expect(useTerminalStore.getState().focusedPaneId).toBe(second.id);
    expect(useUiStore.getState().movePlacement.open).toBe(false);

    rerender({ currentLayout: movedTab.layout });
    act(() => result.current.setRatioNode(second.id, first.id, 0.7));
    const resizedTab = useSessionStore.getState().tabs[0];
    if (resizedTab?.kind !== 'session' || resizedTab.layout.type !== 'split') return;
    expect(resizedTab.layout.ratio).toBe(0.7);
  });
});
