import { t } from '@i18n';
import { OutlineButton } from '@ui/actions/OutlineButton';
import { useSessionStore } from '@features/workspace';
import { useTerminalStore } from '@features/terminal';
import { useChatStore } from '../stores/chat';
import { showExecutionTerminal } from '../services/conversationContext';

export default function ConversationSettingsActions({ conversationId, onCloseMenu, onCloseConversation, closeDisabled }: {
  conversationId?: string;
  onCloseMenu: () => void;
  onCloseConversation?: () => void;
  closeDisabled?: boolean;
}) {
  const environment = useChatStore(state => state.conversations.find(item => item.id === conversationId)?.environment);
  const connected = useTerminalStore(state => !!environment && !!state.sessions[environment.paneId]);
  return <div className="chat-setting-links">
    {environment && connected && <OutlineButton onClick={() => { onCloseMenu(); showExecutionTerminal(environment.paneId); }}>{t('View terminal')}</OutlineButton>}
    <OutlineButton data-testid="chat-usage-entry" onClick={() => { onCloseMenu(); useSessionStore.getState().openUsageTab(); }}>{t('Usage statistics')}</OutlineButton>
    <OutlineButton onClick={() => { onCloseMenu(); useSessionStore.getState().openSettings(); }}>{t('Open settings')}</OutlineButton>
    {onCloseConversation && <OutlineButton className="chat-close-conversation" tone="danger" aria-label={t('Close this conversation')} disabled={closeDisabled} onClick={() => { onCloseMenu(); onCloseConversation(); }}>{t('Close')}</OutlineButton>}
  </div>;
}
