import { useEffect, type CSSProperties } from 'react';
import { selectActiveSessionTab, useSessionStore, useDockStore } from '@features/workspace';
import { MIN_PANE_SIZE, minTerminalWidth } from '@features/workspace/model/windowLayout';
import TopDock from '@features/workspace/components/TopDock';
import SidePanel from '@features/workspace/components/SidePanel';
import TerminalView from '@features/terminal/components/TerminalView';
import ActivityBar from '@features/workspace/components/ActivityBar';
import { ACTIVITY_BAR_WIDTH, PANEL_DEFS, WORKSPACE_GAP, workspaceFrameWidth } from '@features/workspace/stores/dock';
import { useSshStatusOwner } from '@features/workspace/hooks/useAuxiliarySidebar';
import SshAuthenticationDialog from '@features/ssh/components/SshAuthenticationDialog';
import { useSshAuthenticationLifetime } from '@features/ssh/hooks/useSessionAuthentication';

/** Compose navigation, auxiliary panels and the terminal workspace. */
export default function WorkspaceShell() {
  useSshAuthenticationLifetime();
  const frameWidth = useDockStore(workspaceFrameWidth);
  const sshStatusOwner = useSshStatusOwner();
  const leftPanelWidth = useDockStore(state => state.leftPanels.reduce((total, id) => total + (state.collapsedPanels.includes(id) ? 0 : state.panelWidths[id] || PANEL_DEFS[id]?.width || 0), 0));
  const terminalMinWidth = useSessionStore((state) => {
    const tab = selectActiveSessionTab(state);
    return tab ? minTerminalWidth(tab.layout) : MIN_PANE_SIZE;
  });

  useEffect(() => {
    const reconcile = () => useDockStore.getState().reconcilePanelSpace();
    reconcile();
    window.addEventListener('resize', reconcile);
    return () => window.removeEventListener('resize', reconcile);
  }, [terminalMinWidth, sshStatusOwner]);

  return (
    <>
      <TopDock />
      <SshAuthenticationDialog />
      <div className="workspace-body" style={{ '--workspace-frame-width': `${frameWidth}px`, '--workspace-terminal-min-width': `${Math.max(360, terminalMinWidth)}px`, '--workspace-left-panel-width': `${leftPanelWidth}px`, '--workspace-activity-width': `${ACTIVITY_BAR_WIDTH}px`, '--workspace-gap': `${WORKSPACE_GAP}px` } as CSSProperties}>
        <ActivityBar />
        <SidePanel side="left" />
        <main className="workspace-main" style={{ flex: 1, minWidth: terminalMinWidth, display: 'flex', flexDirection: 'column' }}>
          <TerminalView />
        </main>
        <SidePanel side="right" />
        <div id="ssh-status-sidebar-host" className="workspace-ssh-status-slot" />
      </div>
    </>
  );
}
