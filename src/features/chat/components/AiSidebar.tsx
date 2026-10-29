import { useEffect, useState } from 'react';
import { t } from '@i18n';
import Select, { SelectTrigger } from '@ui/fields/Select';
import { IconButton } from '@ui/actions/IconButton';
import { SlidersHorizontal } from '@ui/icons';
import AppMark from '@ui/icons/AppMark';
import type { MenuAnchor } from '@ui/menus/ContextMenu';
import SettingsPopover from '@ui/menus/SettingsPopover';
import type { DropdownAnchor } from '@ui/menus/AnchoredDropdown';
import { ResourceContentSlot } from '@ui/layout/ResourceContent';
import AcpLauncher from '@features/workspace/components/AcpLauncher';
import { useSessionStore as useWorkspaceStore, usePlacedWorkspaceResourceIds } from '@features/workspace';
import { harnessMark } from '@features/agent/components/HarnessBadge';
import { useAiWorkspace } from '../stores/aiWorkspace';
import { useChatStore } from '../stores/chat';
import { useHarnessWorkspace } from '../stores/harnessWorkspace';
import { useHarnessStore } from '../stores/harness';
import { availableSideConversationIds, closeAiWorkspaceSession, createSideAgent, createSideConversation } from '../services/aiWorkspace';
import ConversationHeading from './ConversationHeading';
import ConversationSettingsActions from './ConversationSettingsActions';

export default function AiSidebar({ active, onSettingsTarget, settingsSuspended = false }: {
  active: boolean; onSettingsTarget?: (target: HTMLDivElement | null) => void; settingsSuspended?: boolean;
}) {
  const { nativeTabs, sideSelected } = useAiWorkspace();
  const conversations = useChatStore(state => state.conversations);
  const loaded = useChatStore(state => state.conversationsLoaded);
  const placedIds = usePlacedWorkspaceResourceIds('ai');
  const connections = useHarnessWorkspace(state => state.connections);
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const [launcher, setLauncher] = useState<{ anchor: DropdownAnchor } | null>(null);
  const conversation = conversations.find(item => `chat:${item.id}` === sideSelected);
  const connection = connections.find(item => `acp:${item.id}` === sideSelected);
  const agentTitle = useHarnessStore(state => connection ? state.byTab[connection.id]?.messages.find(message => message.role === 'user')?.content.slice(0, 48) : undefined);
  const available = availableSideConversationIds(placedIds);
  const options = [
    ...nativeTabs.flatMap(id => { const conversation = conversations.find(item => item.id === id); return conversation ? [{ value: `chat:${id}`, label: conversation.title, icon: <AppMark colored size={16} /> }] : []; }),
    ...connections.map(connection => { const Mark = harnessMark(connection.harness); return { value: `acp:${connection.id}`, label: connection.harness, icon: <Mark size={16} /> }; }),
  ].filter(option => available.has(option.value));
  const key = options.map(option => option.value).join('|');
  const reserved = !available.has(sideSelected);
  useEffect(() => {
    if (!active || !loaded || !reserved && options.some(option => option.value === sideSelected)) return;
    if (useAiWorkspace.getState().sideSelected !== sideSelected) return;
    const previous = options[options.length - 1]?.value;
    if (previous) useAiWorkspace.getState().selectSide(previous);
    else createSideConversation();
  }, [active, loaded, sideSelected, reserved, key]);
  useEffect(() => { if (!active) { setMenu(null); setLauncher(null); } }, [active]);
  return <div className="ai-sidebar-content" data-testid="ai-sidebar-content">
    <ConversationHeading title={conversation?.title ?? agentTitle ?? connection?.harness ?? t('AI chat')}
      onRename={conversation ? title => useChatStore.getState().renameConversation(conversation.id, title) : undefined}
      onHistory={() => useWorkspaceStore.getState().openAiHistoryTab()}
      onNew={() => connection ? createSideAgent(connection.harness, connection.cwd) : createSideConversation()}
      settings={<IconButton compact aria-label={t('Conversation settings')} data-tip={t('Conversation settings')} aria-haspopup="dialog" aria-expanded={!!menu} onClick={event => {
        const trigger = event.currentTarget; const bounds = trigger.getBoundingClientRect(); setMenu(current => current ? null : { x: bounds.right - 320, y: bounds.bottom + 4, trigger });
      }}><SlidersHorizontal size={16} /></IconButton>} />
    {sideSelected && !reserved && <ResourceContentSlot id={sideSelected} visible={active} focused />}
    {!sideSelected && <div className="workspace-empty"><p>{t('Start a conversation or choose an ACP agent.')}</p></div>}
    {menu && <SettingsPopover anchor={menu} label={t('Conversation settings')} onClose={() => setMenu(null)} suspended={settingsSuspended || !!launcher}>
      <section className="chat-conversation-settings" aria-label={t('Conversation settings')} data-workspace-focus="ai-side">
        <div className="chat-setting-row"><span>{t('Recent conversations')}</span><Select aria-label={t('Side panel conversation')} value={sideSelected} options={options}
          onChange={id => useAiWorkspace.getState().selectSide(id)} placeholder={t('AI chat')} /></div>
        <div className="chat-setting-row"><span>{t('ACP agents')}</span><SelectTrigger aria-label={t('Choose agent')} aria-haspopup="dialog" aria-expanded={!!launcher} onClick={event => {
          const bounds = event.currentTarget.getBoundingClientRect(); setLauncher({ anchor: { x: bounds.right, y: bounds.bottom + 4, aboveY: bounds.top, align: 'end' } });
        }}><span className="ui-select-value">{connection?.harness ?? t('Choose agent')}</span></SelectTrigger></div>
        <div ref={onSettingsTarget} />
        <ConversationSettingsActions conversationId={conversation?.id} onCloseMenu={() => setMenu(null)}
          closeDisabled={!sideSelected} onCloseConversation={() => closeAiWorkspaceSession(sideSelected)} />
      </section>
    </SettingsPopover>}
    <AcpLauncher open={!!launcher} anchor={launcher?.anchor} onClose={() => setLauncher(null)} onPick={(name, cwd) => {
      createSideAgent(name, cwd);
      setLauncher(null);
    }} />
  </div>;
}
