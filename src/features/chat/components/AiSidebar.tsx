import { useEffect, useState } from 'react';
import { t } from '@i18n';
import Select from '@ui/fields/Select';
import { IconButton } from '@ui/actions/IconButton';
import { History, PanelRight, Plus, X } from '@ui/icons';
import InlineRenameInput from '@ui/fields/InlineRenameInput';
import AppMark from '@ui/icons/AppMark';
import ContextMenu, { type MenuAnchor } from '@ui/menus/ContextMenu';
import type { DropdownAnchor } from '@ui/menus/AnchoredDropdown';
import { ResourceContentSlot } from '@ui/layout/ResourceContent';
import AcpLauncher from '@features/workspace/components/AcpLauncher';
import { useSessionStore as useWorkspaceStore } from '@features/workspace';
import { selectWorkspaceArea } from '@features/workspace/services/selectWorkspaceArea';
import { harnessMark } from '@features/agent/components/HarnessBadge';
import { useAiWorkspace } from '../stores/aiWorkspace';
import { useChatStore } from '../stores/chat';
import { useHarnessWorkspace } from '../stores/harnessWorkspace';
import { closeAiWorkspaceSession, createSideAgent, createSideConversation } from '../services/aiWorkspace';

export default function AiSidebar({ active }: { active: boolean }) {
  const { nativeTabs, sideSelected, selected } = useAiWorkspace();
  const conversations = useChatStore(state => state.conversations);
  const nativeSelected = useChatStore(state => state.activeConversationId);
  const connections = useHarnessWorkspace(state => state.connections);
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const [launcher, setLauncher] = useState<{ anchor: DropdownAnchor } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState('');
  const conversation = conversations.find(item => `chat:${item.id}` === sideSelected);
  const options = [
    ...nativeTabs.flatMap(id => { const conversation = conversations.find(item => item.id === id); return conversation ? [{ value: `chat:${id}`, label: conversation.title, icon: <AppMark colored size={16} /> }] : []; }),
    ...connections.map(connection => { const Mark = harnessMark(connection.harness); return { value: `acp:${connection.id}`, label: connection.harness, icon: <Mark size={16} /> }; }),
  ];
  const key = options.map(option => option.value).join('|');
  useEffect(() => {
    if (!active || options.some(option => option.value === sideSelected)) return;
    const id = options.some(option => option.value === selected) ? selected : options[0]?.value ?? (nativeSelected ? `chat:${nativeSelected}` : '');
    if (id) useAiWorkspace.getState().selectSide(id);
  }, [active, sideSelected, selected, nativeSelected, key]);
  useEffect(() => { if (!active) { setMenu(null); setLauncher(null); } }, [active]);
  useEffect(() => { setRenaming(false); }, [sideSelected]);
  const commitTitle = () => {
    if (conversation && title.trim()) useChatStore.getState().renameConversation(conversation.id, title.trim());
    setRenaming(false);
  };
  const moveToMain = () => {
    const workspace = useWorkspaceStore.getState();
    workspace.openHarnessTab();
    useAiWorkspace.getState().select(sideSelected);
    if (sideSelected.startsWith('chat:')) void useChatStore.getState().selectConversation(sideSelected.slice(5));
    else useHarnessWorkspace.getState().select(sideSelected.slice(4));
    selectWorkspaceArea('ai');
  };
  return <div className="ai-sidebar-content" data-testid="ai-sidebar-content">
    <div className="chat-conversation-heading">
      {renaming ? <InlineRenameInput autoFocus aria-label={t('Conversation title')} value={title} onChange={event => setTitle(event.target.value)}
        onFocus={event => event.currentTarget.select()} onBlur={commitTitle} onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter') commitTitle();
          if (event.key === 'Escape') setRenaming(false);
        }} /> : <Select aria-label={t('Side panel conversation')} value={sideSelected} options={options} onChange={id => useAiWorkspace.getState().selectSide(id)}
        triggerClassName="chat-conversation-title" placeholder={t('AI chat')} style={{ flex: 1, minWidth: 0 }}
        action={conversation ? { label: t('Rename conversation'), onSelect: () => { setTitle(conversation.title); setRenaming(true); } } : undefined} />}
      <div className="chat-conversation-actions">
        <IconButton compact aria-label={t('AI conversation history')} data-tip={t('AI conversation history')} onClick={() => useWorkspaceStore.getState().openAiHistoryTab()}><History size={16} /></IconButton>
        <div ref={setToolbar} className="ai-conversation-toolbar" />
        <IconButton compact aria-label={t('Move AI to workspace')} data-tip={t('Move AI to workspace')} disabled={!sideSelected} onClick={moveToMain}><PanelRight size={16} /></IconButton>
        <IconButton compact aria-label={t('Close this conversation')} data-tip={t('Close this conversation')} disabled={!sideSelected} onClick={() => closeAiWorkspaceSession(sideSelected)}><X size={16} /></IconButton>
        <IconButton compact aria-label={t('New conversation or agent')} data-tip={t('New conversation or agent')} onClick={event => {
          const trigger = event.currentTarget; const bounds = trigger.getBoundingClientRect(); setMenu({ x: bounds.right, y: bounds.bottom + 4, trigger, align: 'end' });
        }}><Plus size={16} /></IconButton>
      </div>
    </div>
    {sideSelected && <ResourceContentSlot id={sideSelected} visible={active} focused toolbarTarget={toolbar} />}
    {!sideSelected && <div className="workspace-empty"><p>{t('Start a conversation or choose an ACP agent.')}</p></div>}
    {menu && <ContextMenu anchor={menu} label={t('New conversation or agent')} itemRole="menuitem" onClose={() => setMenu(null)} items={[
      { label: t('New conversation'), onClick: createSideConversation },
      { label: t('ACP agents'), onClick: () => setLauncher({ anchor: { x: menu.x, y: menu.y, aboveY: menu.y - 4, align: 'end' } }) },
    ]} />}
    <AcpLauncher open={!!launcher} anchor={launcher?.anchor} onClose={() => setLauncher(null)} onPick={(name, cwd) => {
      createSideAgent(name, cwd);
      setLauncher(null);
    }} />
  </div>;
}
