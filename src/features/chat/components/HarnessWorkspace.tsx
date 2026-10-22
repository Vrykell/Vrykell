import { useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@i18n';
import FolderTabs from '@ui/FolderTabs';
import { IconButton } from '@ui/IconButton';
import ConfirmDialog from '@ui/ConfirmDialog';
import { Plus, DataUsage, Folder, Sparkles, Columns2 } from '@ui/icons';
import WorkspaceHeader from '@ui/WorkspaceHeader';
import { OutlineButton } from '@ui/OutlineButton';
import { registerHarnessCloseGuard } from '@core/harness';
import { pickPath } from '@platform/api/fs';
import { useToastStore } from '@ui/Toast';
import AcpLauncher from '@features/workspace/components/AcpLauncher';
import { useSessionStore, useUiStore } from '@features/workspace';
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
import { closeAiWorkspaceSession } from '../services/aiWorkspace';

/** One workspace page hosts independent sessions through the shared connected tabs. */
export default function HarnessWorkspace({ active, headerActive = active }: { active: boolean; headerActive?: boolean }) {
  const surface = useContext(AiSurfaceContext);
  const { connections, selected: harnessSelected } = useHarnessWorkspace();
  const { nativeTabs, selected, order } = useAiWorkspace();
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
  useEffect(() => { if (harnessSelected) useAiWorkspace.getState().select(`acp:${harnessSelected}`); }, [harnessSelected]);
  const settingsOpen = useUiStore(state => state.settingsOpen);
  const visible = active && !settingsOpen;
  const [picker, setPicker] = useState(false);
  const [directory, setDirectory] = useState<string | undefined>(undefined);
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
      if (path) { useSessionStore.getState().openHarnessTab(); setDirectory(path); setPicker(true); }
    } catch { useToastStore.getState().addToast(t('Could not choose a project folder.'), 'error'); }
  };
  const close = (id: string) => {
    if (id.startsWith('page:')) { useSessionStore.getState().closeTab(id.slice(5)); return; }
    closeAiWorkspaceSession(id);
  };
  const pick = (name: string) => {
    useSessionStore.getState().openHarnessTab(name, directory);
    setPicker(false);
    setDirectory(undefined);
  };
  const tabs = [
    ...nativeTabs.flatMap(id => { const conversation = conversations.find(item => item.id === id); return conversation ? [{
      id: `chat:${id}`, label: conversation.title, tip: conversation.title, icon: <Sparkles size={16} />, closeLabel: t('Close session {{name}}', { name: conversation.title }),
    }] : []; }),
    ...connections.map(item => { const Mark = harnessMark(item.harness); return {
        id: `acp:${item.id}`, label: item.harness, tip: item.cwd ? `${item.harness} · ${item.cwd}` : item.harness,
        icon: <Mark size={16} />, closeLabel: t('Close session {{name}}', { name: item.harness }),
    }; }),
    ...pages.flatMap(page => page.kind === 'usage' || page.kind === 'ai-history' ? [{ id: `page:${page.id}`, label: page.title, tip: page.title, dataAttributes: { 'data-tab-kind': page.kind },
      icon: page.kind === 'usage' ? <DataUsage size={16} /> : <Sparkles size={16} />, closeLabel: t('Close this tab') }] : []),
  ];
  const ids = tabs.map(item => item.id);
  useEffect(() => {
    const sessions = ids.filter(id => !id.startsWith('page:'));
    if (!sessions.includes(selected) && sessions.length) {
      const id = sessions[0]!;
      useAiWorkspace.getState().select(id);
      if (id.startsWith('chat:')) void useChatStore.getState().selectConversation(id.slice(5));
    }
  }, [ids.join('|'), selected]);
  const header = <FolderTabs label={t('AI sessions')} selected={activePage && activePage.kind !== 'harness' ? `page:${activePage.id}` : selected} listId="harness-sessions"
      items={orderedWorkspaceIds(ids, order).map(id => tabs.find(item => item.id === id)!)} onSelect={select}
      onMove={(...args) => useAiWorkspace.getState().move(ids, ...args)} onClose={close} menuItems={[
        { label: t('Choose project folder'), onClick: () => void chooseDirectory() },
        { label: t('Usage statistics'), onClick: () => useSessionStore.getState().openUsageTab() },
        ...(selected.startsWith('chat:') ? [{ label: t('Dock AI to side'), onClick: relocate }] : []),
      ]} toolbar={<>
        <div ref={surface?.toolbar} className="ai-conversation-toolbar" style={{ display: placement === 'main' && selected.startsWith('chat:') && activePage?.kind === 'harness' ? 'flex' : 'none' }} />
        <IconButton compact data-testid="ai-new-conversation" aria-label={t('New conversation')} data-tip={t('New conversation')} onClick={() => void newConversation()}><Sparkles size={16} /></IconButton>
        <IconButton compact data-testid="harness-add-session" aria-label={t('Connect a server')} data-tip={t('Connect a server')} onClick={() => { useSessionStore.getState().openHarnessTab(); setPicker(true); }}><Plus size={16} /></IconButton>
        <span className="folder-action-secondary ai-secondary-actions">
        <IconButton compact aria-label={t('Choose project folder')} data-tip={t('Choose project folder')} onClick={() => void chooseDirectory()}><Folder size={16} /></IconButton>
        <IconButton compact aria-label={t('Usage statistics')} data-tip={t('Usage statistics')} onClick={() => useSessionStore.getState().openUsageTab()}><DataUsage size={16} /></IconButton>
        {selected.startsWith('chat:') && <IconButton compact data-testid="ai-relocate" aria-label={t('Dock AI to side')} data-tip={t('Dock AI to side')} onClick={relocate}><Columns2 size={16} /></IconButton>}
        </span>
      </>} />;
  return <div data-testid="harness-workspace" style={{ display: 'flex', flex: 1, minWidth: 0, minHeight: 0, flexDirection: 'column' }}>
    <WorkspaceHeader active={headerActive && !settingsOpen}>{header}</WorkspaceHeader>
    {ids.every(id => id.startsWith('page:')) && <div className="ai-workspace-empty"><OutlineButton onClick={() => void newConversation()}>{t('New conversation')}</OutlineButton><AcpLauncher open={visible} embedded onClose={() => {}} onPick={pick} /></div>}
    {nativeVisited && <div className="ai-native-surface" inert={!visible || !selected.startsWith('chat:')} style={{ display: selected.startsWith('chat:') ? 'flex' : 'none' }}>
      <NativeConversationSurface active={placement === 'main'} />
      {placement === 'side' && <div className="workspace-empty"><p>{t('This conversation is open in the side panel.')}</p><OutlineButton onClick={() => selectWorkspaceArea('ai')}>{t('Move AI to workspace')}</OutlineButton></div>}
    </div>}
    {connections.map(item => <div key={item.id} inert={!visible || `acp:${item.id}` !== selected}
      style={{ display: `acp:${item.id}` === selected ? 'flex' : 'none', flex: 1, minHeight: 0, minWidth: 0 }}>
      <HarnessView tabId={item.id} harness={item.harness} cwd={item.cwd} fresh={item.fresh} active={visible && `acp:${item.id}` === selected} />
    </div>)}
    {ids.some(id => !id.startsWith('page:')) && <AcpLauncher open={picker && visible} onClose={() => { setPicker(false); setDirectory(undefined); }} onPick={pick} />}
    {closing && createPortal(<ConfirmDialog open title={t('Close ACP sessions?')}
      message={t('Closing stops active work and discards unsent drafts.')} confirmLabel={t('Close sessions')} cancelLabel={t('Cancel')} danger
      onCancel={() => setClosing(null)} onConfirm={() => { const complete = closing; setClosing(null); complete(); }} />, document.body)}
  </div>;
}
