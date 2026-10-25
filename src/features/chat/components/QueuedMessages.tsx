import { t } from '@i18n';
import { X } from '@ui/icons';
import { IconButton } from '@ui/actions/IconButton';

export default function QueuedMessages({ messages, onCancel }: { messages: { id: string; text: string }[]; onCancel: (id: string) => void }) {
  if (!messages.length) return null;
  return <div className="chat-queued-messages" role="list" aria-label={t('Queued messages')}>
    {messages.map(message => <div key={message.id} className="chat-queued-message" role="listitem">
      <span><small>{t('Waiting to send')}</small><span data-tip={message.text}>{message.text || t('Message with attachments')}</span></span>
      <IconButton compact aria-label={t('Cancel queued message')} data-tip={t('Cancel queued message')} onClick={() => onCancel(message.id)}><X size={14} /></IconButton>
    </div>)}
  </div>;
}
