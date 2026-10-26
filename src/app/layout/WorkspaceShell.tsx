import { useEffect, useState, type CSSProperties } from 'react';
import { memoLocalized } from '@ui/hooks/memoLocalized';
import { selectActiveSessionTab, useSessionStore, useDockStore, useUiStore, ScopedPaneWorkspace, useScopedSplitActive } from '@features/workspace';
import SettingsScreen from '@features/settings/components/SettingsScreen';
import { MIN_PANE_SIZE, minTerminalWidth } from '@features/workspace/model/windowLayout';
import TopDock from '@features/workspace/components/TopDock';
import SidePanel from '@features/workspace/components/SidePanel';
import PanelSurfaces from '@features/workspace/components/PanelSurfaces';
import TerminalView from '@features/terminal/components/TerminalView';
import WorkspaceSidebar from '@features/workspace/components/WorkspaceSidebar';
import PanelTabs from '@features/workspace/components/PanelTabs';
import { WORKSPACE_GAP, workspaceFrameWidth } from '@features/workspace/stores/dock';
import { useWorkspaceNavigation, workspaceAreaForKind, workspaceSidebarWidth } from '@features/workspace/stores/navigation';
import { WorkspaceHeaderProvider, WorkspaceHeaderSlot } from '@ui/layout/WorkspaceHeader';
import { AiWorkspaceProvider } from '@features/chat/components/AiWorkspaceSurface';
import PanelSsh from '@features/ssh/components/PanelSsh';
import PortForwardingPage from '@features/ssh/components/PortForwardingPage';
import { useAiWorkspace } from '@features/chat/stores/aiWorkspace';
import { useHarnessWorkspace } from '@features/chat/stores/harnessWorkspace';
import './workspaceLayout.css';
import { useSshStatusOwner } from '@features/workspace/hooks/useAuxiliarySidebar';
import SshAuthenticationDialog from '@features/ssh/components/SshAuthenticationDialog';
import { useSshAuthenticationLifetime } from '@features/ssh/hooks/useSessionAuthentication';
import GitWorkspace from '@features/git/components/GitWorkspace';
import { useGitContext } from '@features/git/hooks/useGitContext';
import EditorWorkspace from '@features/editor/components/EditorWorkspace';
import HistoryWorkspaceView from '@features/session-history/components/HistoryWorkspaceView';
import { ResourceContentProvider } from '@ui/layout/ResourceContent';
import UnifiedWorkspace from '@features/workspace/components/UnifiedWorkspace';
import { editorFileKey } from '@core/editor';
import { gitComparisonKey } from '@core/git';
import { useGitSelection } from '@features/git';

const StableTerminalView = memoLocalized(TerminalView);
const StablePanelTabs = memoLocalized(PanelTabs);
const StableTopDock = memoLocalized(TopDock);
const StableHistoryWorkspace = memoLocalized(HistoryWorkspaceView);
const StableHosts = memoLocalized(PanelSsh);
const StablePortForwarding = memoLocalized(PortForwardingPage);
const StableSettings = memoLocalized(SettingsScreen);
const StableSidePanel = memoLocalized(SidePanel);

/** Compose navigation, auxiliary panels and the terminal workspace. */
export default function WorkspaceShell() {
  useSshAuthenticationLifetime();
  useGitContext();
  const settingsOpen = useUiStore(state => state.settingsOpen);
  const area = useWorkspaceNavigation(state => state.area);
  const collapsed = useWorkspaceNavigation(state => state.collapsed);
  const sidebarOverlay = useWorkspaceNavigation(state => state.sidebarOverlay);
  const sidebarPreference = useWorkspaceNavigation(state => state.sidebarWidth);
  const sidebarDragWidth = useWorkspaceNavigation(state => state.sidebarDragWidth);
  const aiPlacement = useWorkspaceNavigation(state => state.aiPlacement);
  const activeTab = useSessionStore(state => state.tabs.find(tab => tab.id === state.activeId));
  const contentVisible = !!activeTab && activeTab.kind !== 'workspace' && area === workspaceAreaForKind(activeTab.kind);
  const codeSplit = useScopedSplitActive('code');
  const gitSelection = useGitSelection();
  const codeResourceId = activeTab?.kind === 'editor' ? `file:${editorFileKey(activeTab.selected)}` : activeTab?.kind === 'git-diff'
    ? `diff:${activeTab.comparisons?.find(item => gitSelection && gitComparisonKey(item.selection) === gitComparisonKey(gitSelection))?.id ?? activeTab.id}` : '';
  const chatOpen = useDockStore(state => state.leftPanels.includes('chat') || state.rightPanels.includes('chat'));
  const chatOnLeft = useDockStore(state => state.leftPanels.includes('chat'));
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const sessionTabs = useSessionStore(state => state.tabs);
  const nativeTabs = useAiWorkspace(state => state.nativeTabs);
  const harnessConnections = useHarnessWorkspace(state => state.connections);
  const frameWidth = useDockStore(workspaceFrameWidth);
  const sshStatusOwner = useSshStatusOwner();
  const terminalMinWidth = useSessionStore((state) => {
    const tab = selectActiveSessionTab(state);
    return tab ? minTerminalWidth(tab.layout) : MIN_PANE_SIZE;
  });
  const mainMinWidth = Math.max(360, area === 'terminal' ? terminalMinWidth : MIN_PANE_SIZE);
  const sidebarWidth = workspaceSidebarWidth(viewportWidth, mainMinWidth);
  const sidebarMaxWidth = sidebarOverlay ? Math.min(400, viewportWidth - 40) : Math.min(400, viewportWidth - mainMinWidth);
  const overlayWidth = Math.min(sidebarDragWidth ?? sidebarPreference, Math.max(160, sidebarMaxWidth));

  useEffect(() => {
    const reconcile = () => {
      setViewportWidth(window.innerWidth);
      const width = workspaceSidebarWidth(window.innerWidth, Math.max(360, area === 'terminal' ? terminalMinWidth : MIN_PANE_SIZE));
      const navigation = useWorkspaceNavigation.getState();
      if (!width && !navigation.collapsed && !navigation.sidebarOverlay) navigation.setCollapsed(true);
      useDockStore.getState().reconcilePanelSpace();
    };
    reconcile();
    window.addEventListener('resize', reconcile);
    return () => window.removeEventListener('resize', reconcile);
  }, [terminalMinWidth, sshStatusOwner, collapsed, sidebarOverlay, area, sidebarPreference]);
  useEffect(() => {
    if (!sidebarOverlay || collapsed) return;
    const close = () => useWorkspaceNavigation.getState().setCollapsed(true);
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('.workspace-primary')) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      close();
      requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[data-testid="workspace-sidebar-expand"]')?.focus());
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape); };
  }, [sidebarOverlay, collapsed]);
  // Safety net for every path that can empty a strip: close, group archive, restore and reload.
  useEffect(() => { useSessionStore.getState().ensureStartPages(); }, [sessionTabs, nativeTabs, harnessConnections, area]);

  return (
    <div className="workspace-layout" data-area={area} data-sidebar-overlay={sidebarOverlay && !collapsed || undefined} data-settings-open={settingsOpen || undefined} style={{ '--workspace-sidebar-width': `${sidebarWidth}px`, '--workspace-sidebar-overlay-width': `${overlayWidth}px` } as CSSProperties}>
      <WorkspaceHeaderProvider>
      <ResourceContentProvider>
      <AiWorkspaceProvider placement={aiPlacement} mainActive={contentVisible && area === 'ai' && (activeTab?.kind === 'harness' || activeTab?.kind === 'ai-history' || activeTab?.kind === 'usage' || activeTab?.kind === 'start-ai') && !settingsOpen} headerActive={area === 'ai' && !settingsOpen} sideActive={chatOpen && (chatOnLeft ? !collapsed : !sshStatusOwner) && !settingsOpen}>
      <PanelSurfaces>
      <WorkspaceSidebar maxWidth={Math.max(160, sidebarMaxWidth)} />
      <StableTopDock sidebarOverlayRequired={viewportWidth - mainMinWidth < 160} />
      <SshAuthenticationDialog />
      <StablePanelTabs active={area === 'terminal' && !settingsOpen} />
      <div className="workspace-body" data-settings-open={settingsOpen || undefined} style={{ '--workspace-frame-width': `${frameWidth}px`, '--workspace-terminal-min-width': `${Math.max(360, area === 'terminal' ? terminalMinWidth : MIN_PANE_SIZE)}px`, '--workspace-left-panel-width': '0px', '--workspace-activity-width': `${sidebarWidth}px`, '--workspace-gap': `${WORKSPACE_GAP}px` } as CSSProperties}>
        <div className="workspace-primary" style={{ minWidth: area === 'terminal' ? terminalMinWidth : 0 }}>
        <WorkspaceHeaderSlot visible={!settingsOpen && (area === 'terminal' || area === 'code' || area === 'ai' || area === 'unified')} />
        <main className="workspace-main" inert={settingsOpen} aria-hidden={settingsOpen || undefined} style={{ flex: 1, minWidth: area === 'terminal' ? terminalMinWidth : 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
          <div className="workspace-content-host" style={{ display: contentVisible && !(area === 'code' && codeSplit && codeResourceId) ? 'flex' : 'none' }} inert={!contentVisible}>
            <EditorWorkspace><GitWorkspace><StableTerminalView active={contentVisible && !settingsOpen} /></GitWorkspace></EditorWorkspace>
          </div>
          <div className="workspace-resource-page" data-testid="ssh-workspace" style={{ display: area === 'ssh' ? 'flex' : 'none' }} inert={area !== 'ssh'}><StableHosts active={area === 'ssh' && !settingsOpen} /></div>
          <div className="workspace-resource-page" data-testid="forwarding-workspace" style={{ display: area === 'forwarding' ? 'flex' : 'none' }} inert={area !== 'forwarding'}><StablePortForwarding active={area === 'forwarding' && !settingsOpen} /></div>
          {area === 'history' && <StableHistoryWorkspace />}
          <UnifiedWorkspace active={area === 'unified'} />
          <ScopedPaneWorkspace scope="code" selected={codeResourceId} active={area === 'code' && !!codeResourceId} />
        </main>
        </div>
        <StableSidePanel side="right" />
        <div id="ssh-status-sidebar-host" className="workspace-ssh-status-slot" inert={settingsOpen} aria-hidden={settingsOpen || undefined} />
        {settingsOpen && <StableSettings />}
      </div>
      </PanelSurfaces>
      </AiWorkspaceProvider>
      </ResourceContentProvider>
      </WorkspaceHeaderProvider>
    </div>
  );
}
