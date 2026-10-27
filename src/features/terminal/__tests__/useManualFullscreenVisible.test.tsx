import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { workspaceAreaStores } from '@features/workspace/stores/paneWorkspace';
import { useTerminalStore } from '../stores/terminal';
import { useManualFullscreenVisible } from '../hooks/useManualFullscreenVisible';
import { useUnifiedWorkspace } from '@features/workspace/stores/unifiedWorkspace';
import { useWorkspaceNavigation } from '@features/workspace/stores/navigation';
import { useWorkspaceStore } from '@features/workspace/stores/workspace';
import { leaf } from '@features/workspace/model/windowLayout';

const session = { id: 'window', title: 'Terminal', kind: 'session' as const, layout: leaf({ id: 'pane-a', kind: 'local' as const }) };

describe('useManualFullscreenVisible', () => {
  const terminalSnapshot = useTerminalStore.getState();
  const workspaceSnapshot = useWorkspaceStore.getState();
  const navigationSnapshot = useWorkspaceNavigation.getState();
  const unifiedSnapshot = useUnifiedWorkspace.getState();

  beforeEach(() => {
    useTerminalStore.setState({ sessions: { 'pane-a': 'session-a' }, focusedPaneId: 'pane-a', manualFullscreen: { 'pane-a': true } });
    useWorkspaceStore.setState({ tabs: [session], activeId: session.id });
    useUnifiedWorkspace.setState({ layout: null, activeTabId: '', startActive: false });
    useWorkspaceNavigation.setState({ area: 'terminal' });
  });

  afterEach(() => {
    useTerminalStore.setState(terminalSnapshot, true);
    useWorkspaceStore.setState(workspaceSnapshot, true);
    useWorkspaceNavigation.setState(navigationSnapshot, true);
    useUnifiedWorkspace.setState(unifiedSnapshot, true);
  });

  it('reveals a placed pane while its composition tab owns the unified workspace', () => {
    useUnifiedWorkspace.setState({ layout: { type: 'pane', id: 'cell-a', resourceId: 'terminal:pane-a' }, startActive: false });
    useWorkspaceNavigation.setState({ area: 'unified' });
    useTerminalStore.setState({ focusedPaneId: 'pane-a' });

    const { result } = renderHook(() => useManualFullscreenVisible('pane-a'));

    expect(result.current).toBe(true);
  });

  it('keeps an unplaced pane hidden when its session tab is inactive', () => {
    useWorkspaceNavigation.setState({ area: 'unified' });

    const { result } = renderHook(() => useManualFullscreenVisible('pane-a'));

    expect(result.current).toBe(false);
  });

  it('keeps the native terminal fullscreen independent of the unified layout', () => {
    useUnifiedWorkspace.setState({ layout: { type: 'pane', id: 'cell-a', resourceId: 'terminal:pane-a' }, startActive: false });

    const { result } = renderHook(() => useManualFullscreenVisible('pane-a'));

    expect(result.current).toBe(true);
  });

  it('lets the shared merge placement remain visible above fullscreen terminal content', () => {
    const { result } = renderHook(() => useManualFullscreenVisible('pane-a'));
    expect(result.current).toBe(true);
    act(() => workspaceAreaStores.terminal.getState().chooseMerge('source'));
    expect(result.current).toBe(false);
    act(() => workspaceAreaStores.terminal.getState().chooseMerge());
    expect(result.current).toBe(true);
  });
});
