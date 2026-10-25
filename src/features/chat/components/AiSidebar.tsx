import { useEffect, useState } from 'react';
import { t } from '@i18n';
import Select from '@ui/fields/Select';
import { IconButton } from '@ui/actions/IconButton';
import { SlidersHorizontal } from '@ui/icons';
import { OutlineButton } from '@ui/actions/OutlineButton';
import AppMark from '@ui/icons/AppMark';
import type { MenuAnchor } from '@ui/menus/ContextMenu';
import SettingsPopover from '@ui/menus/SettingsPopover';
import type { DropdownAnchor } from '@ui/menus/AnchoredDropdown';
import { ResourceContentSlot } from '@ui/layout/ResourceContent';
import AcpLauncher from '@features/workspace/components/AcpLauncher';
import { useSessionStore as useWorkspaceStore } from '@features/workspace';
import { harnessMark } from '@features/agent/components/HarnessBadge';
import { useAiWorkspace } from '../stores/aiWorkspace';
import { useChatStore } from '../stores/chat';
import { useHarnessWorkspace } from '../stores/harnessWorkspace';
import { useHarnessStore } from '../stores/harness';
import { closeAiWorkspaceSession, createSideAgent, createSideConversation } from '../services/aiWorkspace';
import ConversationHeading from './ConversationHeading';

export default function AiSidebar({ active, onSettingsTarget, settingsSuspended = false }: {
  active: boolean; onSettingsTarget?: (target: HTMLDivElement | null) => void; settingsSuspended?: boolean;
}) {
  const { nativeTabs, sideSelected, selected } = useAiWorkspace();
  const conversations = useChatStore(state => state.conversations);
  const nativeSelected = useChatStore(state => state.activeConversationId);
  const connections = useHarnessWorkspace(state => state.connections);
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const [launcher, setLauncher] = useState<{ anchor: DropdownAnchor } | null>(null);
  const conversation = conversations.find(item => `chat:${item.id}` === sideSelected);
  const connection = connections.find(item => `acp:${item.id}` === sideSelected);
  const agentTitle = useHarnessStore(state => connection ? state.byTab[connection.id]?.messages.find(message => message.role === 'user')?.content.slice(0, 48) : undefined);
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
  return <div className="ai-sidebar-content" data-testid="ai-sidebar-content">
    <ConversationHeading title={conversation?.title ?? agentTitle ?? connection?.harness ?? t('AI chat')}
      onRename={conversation ? title => useChatStore.getState().renameConversation(conversation.id, title) : undefined}
      onHistory={() => useWorkspaceStore.getState().openAiHistoryTab()}
      onNew={() => connection ? createSideAgent(connection.harness, connection.cwd) : createSideConversation()}
      settings={<IconButton compact aria-label={t('Conversation settings')} data-tip={t('Conversation settings')} aria-haspopup="dialog" aria-expanded={!!menu} onClick={event => {
        const trigger = event.currentTarget; const bounds = trigger.getBoundingClientRect(); setMenu(current => current ? null : { x: bounds.right - 320, y: bounds.bottom + 4, trigger });
      }}><SlidersHorizontal size={16} /></IconButton>} />
    {sideSelected && <ResourceContentSlot id={sideSelected} visible={active} focused />}
    {!sideSelected && <div className="workspace-empty"><p>{t('Start a conversation or choose an ACP agent.')}</p></div>}
    {menu && <SettingsPopover anchor={menu} label={t('Conversation settings')} onClose={() => setMenu(null)} suspended={settingsSuspended || !!launcher}>
      <section className="chat-conversation-settings" aria-label={t('Conversation settings')} data-workspace-focus="ai">
        <div className="chat-setting-row"><span>{t('Recent conversations')}</span><Select aria-label={t('Side panel conversation')} value={sideSelected} options={options}
          onChange={id => useAiWorkspace.getState().selectSide(id)} placeholder={t('AI chat')} /></div>
        <div className="chat-setting-row"><span>{t('ACP agents')}</span><OutlineButton onClick={event => {
          const bounds = event.currentTarget.getBoundingClientRect(); setLauncher({ anchor: { x: bounds.right, y: bounds.bottom + 4, aboveY: bounds.top, align: 'end' } });
        }}>{t('Choose agent')}</OutlineButton></div>
        <div ref={onSettingsTarget} />
        <div className="chat-setting-links">
          <button type="button" data-subtle disabled={!sideSelected} onClick={() => { setMenu(null); closeAiWorkspaceSession(sideSelected); }}>{t('Close this conversation')}</button>
        </div>
      </section>
    </SettingsPopover>}
    <AcpLauncher open={!!launcher} anchor={launcher?.anchor} onClose={() => setLauncher(null)} onPick={(name, cwd) => {
      createSideAgent(name, cwd);
      setLauncher(null);
    }} />
  </div>;
}
