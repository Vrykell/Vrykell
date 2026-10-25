import { useEffect, useState, type ReactNode } from 'react';
import { t } from '@i18n';
import { History, Plus } from '@ui/icons';
import { IconButton } from '@ui/actions/IconButton';
import InlineRenameInput from '@ui/fields/InlineRenameInput';

export default function ConversationHeading({ title, onRename, onHistory, onNew, settings }: {
  title: string; onRename?: (title: string) => void; onHistory: () => void; onNew: () => void; settings: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  useEffect(() => { setEditing(false); }, [title]);
  const commit = () => { if (value.trim()) onRename?.(value.trim()); setEditing(false); };
  return <div className="chat-conversation-heading">
    {editing ? <InlineRenameInput autoFocus aria-label={t('Conversation title')} value={value} onChange={event => setValue(event.target.value)}
      onFocus={event => event.currentTarget.select()} onBlur={commit} onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') setEditing(false);
      }} /> : onRename ? <button type="button" data-subtle className="chat-conversation-title" data-tip={t('Rename conversation')} aria-label={t('Rename conversation')}
        onClick={() => { setValue(title); setEditing(true); }}>{title}</button> : <span className="chat-conversation-title">{title}</span>}
    <div className="chat-conversation-actions">
      <IconButton compact aria-label={t('AI conversation history')} data-tip={t('AI conversation history')} onClick={onHistory}><History size={16} /></IconButton>
      {settings}
      <IconButton compact aria-label={t('New conversation')} data-tip={t('New conversation')} onClick={onNew}><Plus size={16} /></IconButton>
    </div>
  </div>;
}
