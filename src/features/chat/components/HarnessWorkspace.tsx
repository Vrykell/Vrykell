import { useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@i18n';
import FolderTabs from '@ui/layout/FolderTabs';
import { IconButton } from '@ui/actions/IconButton';
import ConfirmDialog from '@ui/feedback/ConfirmDialog';
import { Plus, DataUsage, Folder, PanelRight, History, Sparkles } from '@ui/icons';
import AppMark from '@ui/icons/AppMark';
import WorkspaceHeader from '@ui/layout/WorkspaceHeader';
import ResourceContent from '@ui/layout/ResourceContent';
import { registerHarnessCloseGuard } from '@core/harness';
import { pickPath } from '@platform/api/fs';
import { useToastStore } from '@ui/feedback/Toast';
import AcpLauncher from '@features/workspace/components/AcpLauncher';
import { useSessionStore, useUiStore, ScopedPaneWorkspace, useScopedSplitActive, WorkspaceResourceSwitcher, WorkspaceSplitAction } from '@features/workspace';
import { UnifiedHistoryView } from '@features/session-history';
import UsageView from '@features/agent/components/UsageView';
import { harnessMark } from '@features/agent/components/HarnessBadge';
import { useHarnessStore } from '../stores/harness';
import { useHarnessWorkspace } from '../stores/harnessWorkspace';
import { useComposerDrafts } from '../stores/composerDrafts';
import HarnessView from './HarnessView';
import NativeConversationSurface, { AiSurfaceContext } from './NativeConversationSurface';
import { useChatStore } from '../stores/chat';
import { useAiWorkspace } from '../stores/aiWorkspace';
import { orderedWorkspaceIds, useWorkspaceNavigation } from '@features/workspace';
import { selectWorkspaceArea } from '@features/workspace/services/selectWorkspaceArea';
import { useDockStore } from '@features/workspace';
import { closeAiWorkspaceSession, moveMainConversationToSide } from '../services/aiWorkspace';

/** One workspace page hosts independent sessions through the shared connected tabs. */
export default function HarnessWorkspace({ active, headerActive = active }: { active: boolean; headerActive?: boolean }) {
  const surface = useContext(AiSurfaceContext);
  const { connections } = useHarnessWorkspace();
  const { nativeTabs, selected, sideSelected, sideSessions, order } = useAiWorkspace();
  const conversations = useChatStore(state => state.conversations);
  const nativeSelected = useChatStore(state => state.activeConversationId);
  const placement = useWorkspaceNavigation(state => state.aiPlacement);
  const pages = useSessionStore(state => state.tabs);
  const activePageId = useSessionStore(state => state.activeId);
  const activePage = pages.find(page => page.id === activePageId);
  const lastNative = useRef(nativeSelected);
  const [nativeVisited, setNativeVisited] = useState(nativeTabs.length > 0);
  useEffect(() => { if (nativeTabs.length) setNativeVisited(true); }, [nativeTabs.length]);
  useEffect(() => {
    if (nativeSelected && nativeSelected !== lastNative.current && (nativeVisited || nativeTabs.length > 0)) {
      if (placement === 'main') useAiWorkspace.getState().openNative(nativeSelected);
      else useAiWorkspace.getState().ensureNative(nativeSelected);
    }
    lastNative.current = nativeSelected;
  }, [nativeSelected, nativeVisited, nativeTabs.length, placement]);
  const settingsOpen = useUiStore(state => state.settingsOpen);
  const visible = active && !settingsOpen;
  const splitActive = useScopedSplitActive('ai');
  const [directory, setDirectory] = useState<string | undefined>(undefined);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [closing, setClosing] = useState<(() => void) | null>(null);
  const select = (id: string) => {
    if (id.startsWith('page:')) { useSessionStore.getState().activate(id.slice(5)); return; }
    if (activePage?.kind !== 'harness' || id.startsWith('chat:')) useSessionStore.getState().openHarnessTab();
    useAiWorkspace.getState().select(id);
    if (id.startsWith('chat:')) void useChatStore.getState().selectConversation(id.slice(5));
    else useHarnessWorkspace.getState().select(id.slice(4));
  };
  const newConversation = () => {
    useSessionStore.getState().openHarnessTab();
    useAiWorkspace.getState().openNative(useChatStore.getState().createConversation());
  };
  const relocate = () => {
    moveMainConversationToSide(selected);
    const dock = useDockStore.getState();
    dock.openPanel('chat');
    if (![...useDockStore.getState().leftPanels, ...useDockStore.getState().rightPanels].includes('chat')) {
      useToastStore.getState().addToast(t('Not enough space. Widen the window or reduce terminal splits.'), 'info');
      return;
    }
    selectWorkspaceArea(useWorkspaceNavigation.getState().previousArea);
  };
  useEffect(() => registerHarnessCloseGuard((ids, complete) => {
    const sessions = useHarnessStore.getState().byTab;
    const drafts = useComposerDrafts.getState().byTab;
    if (!ids.some(id => sessions[id]?.pending || sessions[id]?.opening || sessions[id]?.permission || drafts[id]?.text.trim())) return false;
    setClosing(() => complete);
    return true;
  }), []);
  const chooseDirectory = async () => {
    try {
      const [path] = await pickPath('directory');
      if (path) { setDirectory(path); setLauncherOpen(true); }
    } catch { useToastStore.getState().addToast(t('Could not choose a project folder.'), 'error'); }
  };
  const close = (id: string) => {
    if (id.startsWith('page:')) { useSessionStore.getState().closeTab(id.slice(5)); return; }
    closeAiWorkspaceSession(id);
  };
  const pick = (name: string, cwd?: string) => {
    useSessionStore.getState().openHarnessTab(name, cwd ?? directory);
    setDirectory(undefined);
  };
  const systemPages = pages.filter(page => page.kind === 'ai-history' || page.kind === 'usage' || page.kind === 'start-ai');
  const tabs = [
    ...nativeTabs.flatMap(id => { const conversation = conversations.find(item => item.id === id); return conversation && !sideSessions.includes(`chat:${id}`) && `chat:${id}` !== sideSelected ? [{
      id: `chat:${id}`, label: conversation.title, tip: conversation.title, icon: <AppMark colored size={16} />, closeLabel: t('Close session {{name}}', { name: conversation.title }),
    }] : []; }),
    ...connections.filter(item => `acp:${item.id}` !== sideSelected && !sideSessions.includes(`acp:${item.id}`)).map(item => { const Mark = harnessMark(item.harness); return {
        id: `acp:${item.id}`, label: item.harness, tip: item.cwd ? `${item.harness} · ${item.cwd}` : item.harness,
        icon: <Mark size={16} />, closeLabel: t('Close session {{name}}', { name: item.harness }),
    }; }),
    // System pages ride the same strip but sit on the canvas and never enter groups.
    ...systemPages.map(page => ({
      id: `page:${page.id}`, label: page.title, tip: page.title,
      icon: page.kind === 'usage' ? <DataUsage size={16} /> : page.kind === 'start-ai' ? <AppMark colored size={16} /> : <History size={16} />,
      closeLabel: t('Close this tab'), surface: 'canvas' as const, renameable: false,
      dataAttributes: { 'data-tab-kind': page.kind },
    })),
  ];
  const ids = tabs.map(item => item.id);
  const activeSystemPage = activePage && (activePage.kind === 'ai-history' || activePage.kind === 'usage' || activePage.kind === 'start-ai') ? activePage : undefined;
  const stripSelected = activePage?.kind === 'harness' ? selected : activeSystemPage ? `page:${activeSystemPage.id}` : '';
  useEffect(() => {
    const sessions = ids.filter(id => !id.startsWith('page:') && id !== sideSelected);
    if (!sessions.includes(selected) && sessions.length) {
      const id = sessions[0]!;
      useAiWorkspace.getState().select(id);
      if (id.startsWith('chat:')) void useChatStore.getState().selectConversation(id.slice(5));
    }
  }, [ids.join('|'), selected, sideSelected]);
  const header = <FolderTabs label={t('AI sessions')} selected={stripSelected} listId="harness-sessions"
      items={orderedWorkspaceIds(ids, order).map(id => tabs.find(item => item.id === id)!)} onSelect={select}
      onMove={(...args) => useAiWorkspace.getState().move(ids, ...args)} onClose={close}
      onRename={(id, title) => {
        if (id.startsWith('chat:')) useChatStore.getState().renameConversation(id.slice(5), title);
      }} menuItems={[
        { label: t('Choose project folder'), onClick: () => void chooseDirectory() },
        { label: t('Usage statistics'), onClick: () => useSessionStore.getState().openUsageTab() },
        ...(selected ? [{ label: t('Dock AI to side'), onClick: relocate }] : []),
      ]} toolbar={<>
        <WorkspaceResourceSwitcher />
        {!activeSystemPage && selected && <WorkspaceSplitAction resourceId={selected} />}
        <IconButton compact aria-label={t('AI conversation history')} data-tip={t('AI conversation history')} onClick={() => useSessionStore.getState().openAiHistoryTab()}><History size={16} /></IconButton>
        <div ref={surface?.toolbar} className="ai-conversation-toolbar" style={{ display: selected.startsWith('chat:') && activePage?.kind === 'harness' ? 'flex' : 'none' }} />
        <span className="folder-action-secondary ai-secondary-actions">
        <IconButton compact aria-label={t('Choose project folder')} data-tip={t('Choose project folder')} onClick={() => void chooseDirectory()}><Folder size={16} /></IconButton>
        <IconButton compact aria-label={t('Usage statistics')} data-tip={t('Usage statistics')} onClick={() => useSessionStore.getState().openUsageTab()}><DataUsage size={16} /></IconButton>
        {selected && <IconButton compact data-testid="ai-relocate" aria-label={t('Dock AI to side')} data-tip={t('Dock AI to side')} onClick={relocate}><PanelRight size={16} /></IconButton>}
        </span>
        <IconButton compact data-testid="ai-new-conversation" aria-label={t('New conversation')} data-tip={t('New conversation')} onClick={() => void newConversation()}><Sparkles size={16} /></IconButton>
        <IconButton compact data-testid="harness-add-session" aria-label={t('Connect a server')} data-tip={t('Connect a server')} onClick={() => { setDirectory(undefined); setLauncherOpen(true); }}><Plus size={16} /></IconButton>
      </>} />;
  return <div data-testid="harness-workspace" style={{ display: 'flex', flex: 1, minWidth: 0, minHeight: 0, flexDirection: 'column' }}>
    <AcpLauncher open={launcherOpen} onClose={() => setLauncherOpen(false)} onPick={pick} cwd={directory} />
    <WorkspaceHeader active={headerActive && !settingsOpen}>{header}</WorkspaceHeader>
    <ScopedPaneWorkspace scope="ai" active={visible && activePage?.kind === 'harness'} selected={selected} />
    {activeSystemPage && <div data-testid={`ai-system-page-${activeSystemPage.kind}`} style={{ display: visible ? 'flex' : 'none', flex: 1, minHeight: 0, minWidth: 0, flexDirection: 'column' }}>
      {activeSystemPage.kind === 'usage' ? <UsageView />
        : activeSystemPage.kind === 'start-ai' ? <div className="ai-start-page" data-testid="ai-start-page"><AcpLauncher embedded suspended={launcherOpen} open={visible} onClose={() => {}} onPick={pick} onNewConversation={newConversation} /></div>
        : <UnifiedHistoryView preset="conversation" destination="native" />}
    </div>}
    {nativeVisited && <div className="ai-native-surface" inert={!visible || splitActive || activePage?.kind !== 'harness' || !selected.startsWith('chat:')} style={{ display: visible && !splitActive && activePage?.kind === 'harness' && selected.startsWith('chat:') ? 'flex' : 'none' }}>
      <NativeConversationSurface />
    </div>}
    {connections.map(item => <ResourceContent key={item.id} id={`acp:${item.id}`} active={visible && activePage?.kind === 'harness' && `acp:${item.id}` === selected}>
      {state => <HarnessView tabId={item.id} harness={item.harness} cwd={item.cwd} fresh={item.fresh} active={state.visible} resumeSessionId={item.resumeSessionId} />}
    </ResourceContent>)}
    {!activeSystemPage && !selected && <div className="ai-start-page" data-testid="ai-start-page"><AcpLauncher embedded open={visible} onClose={() => {}} onPick={pick} onNewConversation={newConversation} /></div>}
    {closing && createPortal(<ConfirmDialog open title={t('Close ACP sessions?')}
      message={t('Closing stops active work and discards unsent drafts.')} confirmLabel={t('Close sessions')} cancelLabel={t('Cancel')} danger
      onCancel={() => setClosing(null)} onConfirm={() => { const complete = closing; setClosing(null); complete(); }} />, document.body)}
  </div>;
}
