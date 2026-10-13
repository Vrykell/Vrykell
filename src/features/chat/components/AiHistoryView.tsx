import { useEffect, useMemo, useState } from 'react';
import { ask } from '@tauri-apps/plugin-dialog';
import { t } from '@i18n';
import { History, Plus, Search, Sparkles, Trash2 } from '@ui/icons';
import { TextInput } from '@ui/TextInput';
import SidebarItem from '@ui/sidebarItem';
import ErrorBox from '@ui/ErrorBox';
import { useDockStore } from '@features/workspace';
import { useChatStore } from '../stores/chat';

/** The workspace history page owns conversation navigation; the dock keeps the active chat. */
export default function AiHistoryView() {
  const [query, setQuery] = useState('');
  const conversations = useChatStore(state => state.conversations);
  const activeId = useChatStore(state => state.activeConversationId);
  const sendingId = useChatStore(state => state.sendingTab);
  const loading = useChatStore(state => state.conversationsLoading);
  const loaded = useChatStore(state => state.conversationsLoaded);
  const error = useChatStore(state => state.conversationError);
  useEffect(() => { void useChatStore.getState().loadConversations(); }, []);

  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return [...conversations]
      .filter(item => !term || `${item.title} ${item.environment?.label ?? ''} ${item.environment?.cwd ?? ''}`.toLocaleLowerCase().includes(term))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }, [conversations, query]);

  const open = (id: string) => {
    void useChatStore.getState().selectConversation(id);
    useDockStore.getState().openPanel('chat');
  };
  const create = () => {
    useChatStore.getState().createConversation();
    useDockStore.getState().openPanel('chat');
  };
  const remove = async (id: string) => {
    if (await ask(t('Delete this conversation and its messages?'), { title: t('Delete conversation'), kind: 'warning' })) {
      await useChatStore.getState().deleteConversation(id);
    }
  };

  return <div className="ai-history-page" data-testid="ai-history-page">
    <div className="ai-history-header">
      <History size={13} aria-hidden="true" />
      <strong>{t('AI conversation history')}</strong>
      <span className="ai-history-count">· {t('{{count}} conversations', { count: conversations.length })}</span>
      <div className="ai-history-search">
        <Search size={12} aria-hidden="true" />
        <TextInput aria-label={t('Search conversations')} placeholder={t('Search conversations…')}
          value={query} onChange={event => setQuery(event.target.value)} data-testid="ai-history-search" />
      </div>
      <button type="button" className="ai-history-new" onClick={create}><Plus size={12} />{t('New conversation')}</button>
    </div>
    <div className="ai-history-list scroll-region" aria-label={t('AI conversation history')}>
      {error && !loaded && <ErrorBox compact actions={<button type="button" onClick={() => void useChatStore.getState().loadConversations()}>{t('Retry')}</button>}>
        {t('Could not load conversations')}: {error}
      </ErrorBox>}
      {loading && !conversations.length ? <div className="ai-history-empty">{t('Loading conversations…')}</div>
        : visible.length ? visible.map(item => <SidebarItem key={item.id}
          icon={<Sparkles size={16} />} title={item.title}
          subtitle={[item.environment?.label ?? t('Discussion only'), new Date(item.updatedAt).toLocaleDateString()].join(' · ')}
          active={item.id === activeId} testId={`conversation-row-${item.id}`} tabIndex={0}
          tooltip={t('Open conversation')} onClick={() => open(item.id)}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(item.id); } }}
          badge={sendingId === item.id ? <span className="ai-history-working">{t('Working')}</span> : undefined}
          action={sendingId === item.id ? undefined : { icon: <Trash2 size={14} />, label: t('Delete conversation'), onClick: () => void remove(item.id) }} />)
          : error && !loaded ? null
            : <div className="ai-history-empty">{query ? t('No matching conversations') : t('No conversations yet')}</div>}
    </div>
  </div>;
}
