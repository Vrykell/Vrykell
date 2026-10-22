import { useEffect, useState, type CSSProperties } from 'react';
import { selectActiveSessionTab, useSessionStore, useDockStore, useUiStore } from '@features/workspace';
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
import { WorkspaceHeaderProvider, WorkspaceHeaderSlot } from '@ui/WorkspaceHeader';
import { AiWorkspaceProvider } from '@features/chat/components/AiWorkspaceSurface';
import PanelSsh from '@features/ssh/components/PanelSsh';
import NewTabModal from '@features/workspace/components/NewTabModal';
import { OutlineButton } from '@ui/OutlineButton';
import { Terminal, FileCode, Sparkles } from '@ui/icons';
import { openWorkspaceFile } from '@features/workspace/services/workspaceActions';
import { t } from '@i18n';
import './workspaceLayout.css';
import { useSshStatusOwner } from '@features/workspace/hooks/useAuxiliarySidebar';
import SshAuthenticationDialog from '@features/ssh/components/SshAuthenticationDialog';
import { useSshAuthenticationLifetime } from '@features/ssh/hooks/useSessionAuthentication';
import GitWorkspace from '@features/git/components/GitWorkspace';
import { useGitContext } from '@features/git/hooks/useGitContext';
import EditorWorkspace from '@features/editor/components/EditorWorkspace';
import UnifiedHistoryView from '@features/session-history/components/UnifiedHistoryView';

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
  const contentVisible = !!activeTab && area === workspaceAreaForKind(activeTab.kind);
  const chatOpen = useDockStore(state => state.leftPanels.includes('chat') || state.rightPanels.includes('chat'));
  const chatOnLeft = useDockStore(state => state.leftPanels.includes('chat'));
  const [sidebarWidth, setSidebarWidth] = useState(workspaceSidebarWidth);
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const [newTerminal, setNewTerminal] = useState(false);
  const frameWidth = useDockStore(workspaceFrameWidth);
  const sshStatusOwner = useSshStatusOwner();
  const terminalMinWidth = useSessionStore((state) => {
    const tab = selectActiveSessionTab(state);
    return tab ? minTerminalWidth(tab.layout) : MIN_PANE_SIZE;
  });
  const mainMinWidth = Math.max(360, area === 'terminal' ? terminalMinWidth : MIN_PANE_SIZE);
  const sidebarMaxWidth = sidebarOverlay ? Math.min(400, viewportWidth - 40) : Math.min(400, viewportWidth - mainMinWidth);
  const overlayWidth = Math.min(sidebarDragWidth ?? sidebarPreference, Math.max(160, sidebarMaxWidth));

  useEffect(() => {
    const reconcile = () => {
      setViewportWidth(window.innerWidth);
      const width = workspaceSidebarWidth(window.innerWidth, Math.max(360, area === 'terminal' ? terminalMinWidth : MIN_PANE_SIZE));
      setSidebarWidth(width);
      const navigation = useWorkspaceNavigation.getState();
      if (!width && !navigation.collapsed && !navigation.sidebarOverlay) navigation.setCollapsed(true);
      useDockStore.getState().reconcilePanelSpace();
    };
    reconcile();
    window.addEventListener('resize', reconcile);
    return () => window.removeEventListener('resize', reconcile);
  }, [terminalMinWidth, sshStatusOwner, collapsed, sidebarOverlay, area, sidebarPreference, sidebarDragWidth]);
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
  useEffect(() => {
    if (aiPlacement === 'main' && chatOpen) useDockStore.getState().closePanel('chat');
  }, [aiPlacement, chatOpen]);

  return (
    <div className="workspace-layout" data-area={area} data-sidebar-overlay={sidebarOverlay && !collapsed || undefined} data-settings-open={settingsOpen || undefined} style={{ '--workspace-sidebar-width': `${sidebarWidth}px`, '--workspace-sidebar-overlay-width': `${overlayWidth}px` } as CSSProperties}>
      <WorkspaceHeaderProvider>
      <AiWorkspaceProvider placement={aiPlacement} mainActive={contentVisible && area === 'ai' && activeTab?.kind === 'harness' && !settingsOpen} headerActive={area === 'ai' && !settingsOpen} sideActive={chatOpen && (chatOnLeft ? !collapsed : !sshStatusOwner) && !settingsOpen}>
      <PanelSurfaces>
      <WorkspaceSidebar maxWidth={Math.max(160, sidebarMaxWidth)} />
      <TopDock sidebarOverlayRequired={viewportWidth - mainMinWidth < 160} />
      <SshAuthenticationDialog />
      <PanelTabs active={area === 'terminal' && !settingsOpen} />
      <div className="workspace-body" data-settings-open={settingsOpen || undefined} style={{ '--workspace-frame-width': `${frameWidth}px`, '--workspace-terminal-min-width': `${Math.max(360, area === 'terminal' ? terminalMinWidth : MIN_PANE_SIZE)}px`, '--workspace-left-panel-width': '0px', '--workspace-activity-width': `${sidebarWidth}px`, '--workspace-gap': `${WORKSPACE_GAP}px` } as CSSProperties}>
        <div className="workspace-primary" style={{ minWidth: area === 'terminal' ? terminalMinWidth : 0 }}>
        <WorkspaceHeaderSlot />
        <main className="workspace-main" inert={settingsOpen} aria-hidden={settingsOpen || undefined} style={{ flex: 1, minWidth: area === 'terminal' ? terminalMinWidth : 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
          <div className="workspace-content-host" style={{ display: contentVisible ? 'flex' : 'none' }} inert={!contentVisible}>
            <EditorWorkspace><GitWorkspace><TerminalView active={contentVisible && !settingsOpen} /></GitWorkspace></EditorWorkspace>
          </div>
          <div className="workspace-resource-page" data-testid="ssh-workspace" style={{ display: area === 'ssh' ? 'flex' : 'none' }} inert={area !== 'ssh'}><PanelSsh /></div>
          {area === 'history' && <UnifiedHistoryView />}
          {!contentVisible && area !== 'ssh' && area !== 'history' && <div className="workspace-empty" data-testid={`${area}-workspace-empty`}>
            {area === 'code' ? <FileCode size={40} /> : area === 'ai' ? <Sparkles size={40} /> : <Terminal size={40} />}
            <h2>{t(area === 'code' ? 'Your code workspace' : area === 'ai' ? 'Your AI workspace' : 'Your terminal workspace')}</h2>
            <p>{t(area === 'code' ? 'Open files or review changes here.' : area === 'ai' ? 'Conversations and connected agents share this workspace.' : 'Open a local terminal or connect to an SSH host.')}</p>
            <OutlineButton onClick={() => area === 'code' ? void openWorkspaceFile() : area === 'ai' ? useSessionStore.getState().openHarnessTab() : setNewTerminal(true)}>{t(area === 'code' ? 'Open file' : area === 'ai' ? 'Open AI workspace' : 'New terminal')}</OutlineButton>
          </div>}
        </main>
        </div>
        <SidePanel side="right" />
        <div id="ssh-status-sidebar-host" className="workspace-ssh-status-slot" inert={settingsOpen} aria-hidden={settingsOpen || undefined} />
        {settingsOpen && <SettingsScreen />}
      </div>
      <NewTabModal open={newTerminal} onClose={() => setNewTerminal(false)} />
      </PanelSurfaces>
      </AiWorkspaceProvider>
      </WorkspaceHeaderProvider>
    </div>
  );
}
