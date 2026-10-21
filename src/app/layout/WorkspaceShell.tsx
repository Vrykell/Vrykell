import { useEffect, useState, type CSSProperties } from 'react';
import { selectActiveSessionTab, useSessionStore, useDockStore, useUiStore } from '@features/workspace';
import SettingsScreen from '@features/settings/components/SettingsScreen';
import { MIN_PANE_SIZE, minTerminalWidth } from '@features/workspace/model/windowLayout';
import TopDock from '@features/workspace/components/TopDock';
import SidePanel from '@features/workspace/components/SidePanel';
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

/** Compose navigation, auxiliary panels and the terminal workspace. */
export default function WorkspaceShell() {
  useSshAuthenticationLifetime();
  useGitContext();
  const settingsOpen = useUiStore(state => state.settingsOpen);
  const area = useWorkspaceNavigation(state => state.area);
  const collapsed = useWorkspaceNavigation(state => state.collapsed);
  const aiPlacement = useWorkspaceNavigation(state => state.aiPlacement);
  const activeTab = useSessionStore(state => state.tabs.find(tab => tab.id === state.activeId));
  const contentVisible = !!activeTab && area === workspaceAreaForKind(activeTab.kind);
  const chatOpen = useDockStore(state => state.leftPanels.includes('chat') || state.rightPanels.includes('chat'));
  const [sidebarWidth, setSidebarWidth] = useState(workspaceSidebarWidth);
  const [newTerminal, setNewTerminal] = useState(false);
  const frameWidth = useDockStore(workspaceFrameWidth);
  const sshStatusOwner = useSshStatusOwner();
  const terminalMinWidth = useSessionStore((state) => {
    const tab = selectActiveSessionTab(state);
    return tab ? minTerminalWidth(tab.layout) : MIN_PANE_SIZE;
  });

  useEffect(() => {
    const reconcile = () => { setSidebarWidth(workspaceSidebarWidth()); useDockStore.getState().reconcilePanelSpace(); };
    reconcile();
    window.addEventListener('resize', reconcile);
    return () => window.removeEventListener('resize', reconcile);
  }, [terminalMinWidth, sshStatusOwner, collapsed, area]);
  useEffect(() => {
    if (aiPlacement === 'main' && chatOpen) useDockStore.getState().togglePanel('right', 'chat');
  }, [aiPlacement, chatOpen]);

  return (
    <div className="workspace-layout" data-area={area} data-settings-open={settingsOpen || undefined} style={{ '--workspace-sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
      <WorkspaceHeaderProvider>
      <AiWorkspaceProvider placement={aiPlacement} mainActive={contentVisible && area === 'ai' && activeTab?.kind === 'harness' && !settingsOpen} headerActive={area === 'ai' && !settingsOpen} sideActive={chatOpen && !sshStatusOwner && !settingsOpen}>
      <WorkspaceSidebar />
      <TopDock />
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
          {!contentVisible && area !== 'ssh' && <div className="workspace-empty" data-testid={`${area}-workspace-empty`}>
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
      </AiWorkspaceProvider>
      </WorkspaceHeaderProvider>
    </div>
  );
}
