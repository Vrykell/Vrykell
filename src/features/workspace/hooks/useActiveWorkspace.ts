import { useMemo } from 'react';
import { useSessionStore, isSessionTab } from '@features/workspace';
import { useTerminalStore } from '@features/terminal';
import { firstLeaf, leaves as layoutLeaves, type TerminalSpec } from '@features/workspace/model/windowLayout';

/**
 * Single source for the current window, the focused pane and the working directory.
 * File panels, the composer and other views no longer derive "the current terminal"
 * themselves, which keeps the state rules from diverging.
 */
export function useActiveWorkspace() {
  const activeId = useSessionStore((state) => state.activeId);
  const tabs = useSessionStore((state) => state.tabs);
  const terminalCwds = useSessionStore((state) => state.terminalCwds);
  const focusedPaneId = useTerminalStore((state) => state.focusedPaneId);
  const sessions = useTerminalStore((state) => state.sessions);

  const activeTab = useMemo(() => tabs.find((tab) => tab.id === activeId), [activeId, tabs]);
  const resolvedFocusedPaneId = useMemo(() => {
    if (!activeTab || !isSessionTab(activeTab)) return activeId;
    const specs = layoutLeaves(activeTab.layout);
    if (focusedPaneId && sessions[focusedPaneId] && specs.some((spec) => spec.id === focusedPaneId)) {
      return focusedPaneId;
    }
    return firstLeaf(activeTab.layout).id;
  }, [activeId, activeTab, focusedPaneId, sessions]);

  const focusedSpec = useMemo<TerminalSpec | null>(() => {
    if (!activeTab || !isSessionTab(activeTab)) return null;
    return layoutLeaves(activeTab.layout).find((spec) => spec.id === resolvedFocusedPaneId)
      ?? firstLeaf(activeTab.layout);
  }, [activeTab, resolvedFocusedPaneId]);

  const activeCwd = focusedSpec
    ? terminalCwds[focusedSpec.id] ?? focusedSpec.cwd
    : undefined;

  return {
    activeId,
    activeTab,
    focusedPaneId: resolvedFocusedPaneId,
    focusedSpec,
    activeCwd,
    terminalCwds,
    sessions,
  };
}
