import { useMemo, useSyncExternalStore } from 'react';
import { useTerminalStore, useBlockStore } from '@features/terminal';
import { useSessionStore, isSessionTab } from '@features/workspace';
import { leaves as layoutLeaves } from '@features/workspace/model/windowLayout';
import { shellTypeLabel } from '@platform/shells';
import { isInputBoxVisible } from '@features/terminal/inputVisibility';
import { agentControl } from '@features/agent/services/agentControl';
import { t } from '@i18n';

interface UseTerminalInputContextOptions {
  paneId: string;
  focused?: boolean;
  isLongRunning?: boolean;
}

/** Aggregates terminal context for one pane and isolates the composer from store and runtime subscriptions. */
export function useTerminalInputContext({
  paneId,
  focused,
  isLongRunning = false,
}: UseTerminalInputContextOptions) {
  const sessions = useTerminalStore((state) => state.sessions);
  const focusedPaneId = useTerminalStore((state) => state.focusedPaneId);
  const isFocused = focused ?? paneId === focusedPaneId;
  const scene = useTerminalStore((state) => state.scenes[paneId] ?? 'classic');
  const pendingInput = useTerminalStore((state) => state.pendingInput);
  const setPendingInput = useTerminalStore((state) => state.setPendingInput);
  const hasSession = !!sessions[paneId];

  const tabCwd = useSessionStore((state) => {
    const activeTab = state.tabs.find((tab) => tab.id === state.activeId);
    if (!activeTab || !isSessionTab(activeTab)) return undefined;
    const spec = layoutLeaves(activeTab.layout).find((terminal) => terminal.id === paneId);
    return state.terminalCwds[paneId] ?? spec?.cwd;
  });

  const terminalLabel = useSessionStore((state) => {
    const activeTab = state.tabs.find((tab) => tab.id === state.activeId);
    if (!activeTab || !isSessionTab(activeTab)) return undefined;
    const spec = layoutLeaves(activeTab.layout).find((terminal) => terminal.id === paneId);
    if (spec?.kind === 'ssh') return spec.ssh?.name || spec.ssh?.host || 'SSH';
    return spec?.shellType ? shellTypeLabel(spec.shellType) : t('Local');
  });

  const recentGitBranch = useBlockStore((state) => {
    const blocks = state.byTab[paneId] ?? [];
    for (let index = blocks.length - 1; index >= 0; index--) {
      if (blocks[index]?.gitBranch) return blocks[index]!.gitBranch!;
    }
    return null;
  });

  const isAgentInControl = useSyncExternalStore(
    agentControl.subscribe,
    () => agentControl.isControlled(paneId),
  );
  const altScreenActive = scene === 'altScreen';
  const visible = useMemo(
    () => isInputBoxVisible({
      isReadOnly: false,
      isAltScreenActive: altScreenActive,
      isLongRunning,
      isAgentInControl,
      isAgentTaggedIn: false,
    }),
    [altScreenActive, isAgentInControl, isLongRunning],
  );

  return {
    sessions,
    isFocused,
    scene,
    altScreenActive,
    hasSession,
    pendingInput,
    setPendingInput,
    tabCwd,
    terminalLabel,
    recentGitBranch,
    visible,
  };
}
