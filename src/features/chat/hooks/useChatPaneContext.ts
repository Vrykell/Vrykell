import { useCallback, useMemo } from 'react';
import { useTerminalStore } from '@features/terminal';
import { isSessionTab } from '@features/workspace';
import { leaves as layoutLeaves, type TerminalSpec } from '@features/workspace/model/windowLayout';
import { useActiveWorkspace } from '@features/workspace/hooks/useActiveWorkspace';
import { shellTypeLabel } from '@platform/shells';

interface PaneInfo {
  shell: string;
  cwd?: string;
}

/** 统一聊天面板的目标 pane、来源标签和终端上下文推导。 */
export function useChatPaneContext() {
  const {
    activeId,
    activeTab,
    focusedPaneId,
    terminalCwds,
    sessions,
  } = useActiveWorkspace();
  const requestedFocusedPaneId = useTerminalStore((state) => state.focusedPaneId);
  const isSession = !!activeTab && isSessionTab(activeTab);
  const specs = useMemo<TerminalSpec[]>(
    () => (isSession && activeTab ? layoutLeaves(activeTab.layout) : []),
    [activeTab, isSession],
  );

  const paneInfo = useCallback((paneId?: string): PaneInfo | null => {
    if (!paneId || !isSession) return null;
    const spec = specs.find((item) => item.id === paneId);
    if (!spec) return null;
    const shell = spec.kind === 'ssh'
      ? spec.ssh?.name || spec.ssh?.host || 'SSH'
      : spec.shellType ? shellTypeLabel(spec.shellType) : '本地';
    return { shell, cwd: terminalCwds[paneId] ?? spec.cwd };
  }, [isSession, specs, terminalCwds]);

  const paneLabel = useCallback((paneId?: string): string => {
    const info = paneInfo(paneId);
    if (!info) return '本窗口';
    const dir = info.cwd
      ? info.cwd.startsWith('/') && info.cwd.length > 20
        ? '…' + info.cwd.slice(-19)
        : info.cwd.slice(1)
      : '';
    return dir ? `${info.shell} · ${dir}` : info.shell;
  }, [paneInfo]);

  const targetPane = isSession ? focusedPaneId : undefined;
  const targetInfo = paneInfo(targetPane);

  return {
    activeId,
    activeTab,
    sessions,
    isSession,
    targetPane,
    targetInfo,
    targetConnected: targetPane ? !!sessions[targetPane] : false,
    targetFocused: !!targetPane && targetPane === requestedFocusedPaneId,
    paneLabel,
  };
}
