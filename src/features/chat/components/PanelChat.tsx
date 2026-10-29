import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@i18n';
import { TextArea } from '@ui/fields/TextInput';
import KeyHint from '@ui/feedback/KeyHint';
import Select from '@ui/fields/Select';
import ErrorBox from '@ui/feedback/ErrorBox';
import { IconButton } from '@ui/actions/IconButton';
import { OutlineButton } from '@ui/actions/OutlineButton';
import type { MenuAnchor } from '@ui/menus/ContextMenu';
import SettingsPopover from '@ui/menus/SettingsPopover';
import { ArrowDown, ArrowUp, Plus, SlidersHorizontal, Sparkles, Square } from '@ui/icons';
import { useAttachmentComposer } from '@features/agent';
import { useSessionStore } from '@features/workspace';
import { type TerminalSpec } from '@features/workspace/model/windowLayout';
import NewTabModal from '@features/workspace/components/NewTabModal';
import { useTerminalStore } from '@features/terminal';
import { useChatStore, type ChatMessage } from '../stores/chat';
import { EMPTY_COMPOSER_DRAFT, useComposerDrafts } from '../stores/composerDrafts';
import ChatModeSelect from './ChatModeSelect';
import ModelPill from './ModelPill';
import AttachmentChips from './AttachmentChips';
import TerminalReferences from './TerminalReferences';
import AiBlock from './AiBlock';
import { toExchanges } from '../model/exchanges';
import { useChatComposer } from '../hooks/useChatComposer';
import { environmentForPane } from '../services/conversationContext';
import { createExecutionTerminal } from '@features/workspace/services/executionTerminal';
import type { AttachmentMeta } from '@features/agent/model/attachments';
import { useTranscriptFollow } from '../hooks/useTranscriptFollow';
import ChatComposerShell from './ChatComposerShell';
import type { DropdownAnchor } from '@ui/menus/AnchoredDropdown';
import { useExecutionTerminalOptions } from '../hooks/useExecutionTerminalOptions';
import ConversationHeading from './ConversationHeading';
import { SidebarSettingsContext } from './SidebarSettingsContext';
import QueuedMessages from './QueuedMessages';
import ConversationSettingsActions from './ConversationSettingsActions';

const EMPTY_MESSAGES: ChatMessage[] = [];

/** Conversation navigation, references and execution stay independent of terminal focus. */
export default function PanelChat({ active = true, workspace = false, toolbarTarget, conversationId }: { active?: boolean; workspace?: boolean; toolbarTarget?: HTMLElement | null; conversationId?: string }) {
  const activeId = useChatStore(state => conversationId ?? state.activeConversationId);
  const sidebarSettings = useContext(SidebarSettingsContext);
  const inSidebar = sidebarSettings?.resourceId === `chat:${activeId}`;
  const conversations = useChatStore(state => state.conversations);
  const messages = useChatStore(state => state.byTab[activeId] ?? EMPTY_MESSAGES);
  const ready = useChatStore(state => !!activeId && activeId in state.byTab);
  const sending = useChatStore(state => state.sendingTabs.includes(activeId));
  const queuedSends = useChatStore(state => state.queuedSends).filter(item => item.ownerId === activeId);
  const loading = useChatStore(state => state.conversationsLoading);
  const storeLoadError = useChatStore(state => state.conversationError);
  const [scopeLoadError, setScopeLoadError] = useState('');
  const loadError = scopeLoadError || storeLoadError;
  const persistenceError = useChatStore(state => state.persistenceError);
  const conversation = conversations.find(item => item.id === activeId);
  const environment = conversation?.environment;
  const sessions = useTerminalStore(state => state.sessions);
  const [newTabOpen, setNewTabOpen] = useState(false);
  const [newTabAnchor, setNewTabAnchor] = useState<DropdownAnchor>();
  const [settingsMenu, setSettingsMenu] = useState<MenuAnchor | null>(null);
  const settingsOpen = !!settingsMenu;
  const { scrollRef, following, pauseFollow, jumpToLatest, onScroll, onWheel, onTouchMove } = useTranscriptFollow(activeId, messages, active);
  const draft = useChatStore(state => state.draftTabId === activeId ? state.draft : '');
  const composerDraft = useComposerDrafts(state => state.byTab[activeId] ?? EMPTY_COMPOSER_DRAFT);
  const references = composerDraft.references ?? [];
  const setText = useCallback((text: string) => useComposerDrafts.getState().setText(activeId, text), [activeId]);
  const updateAttachments = useCallback((update: (current: AttachmentMeta[]) => AttachmentMeta[]) => {
    useComposerDrafts.getState().updateAttachments(activeId, update);
  }, [activeId]);
  const clearReferences = useCallback(() => useComposerDrafts.getState().setReferences(activeId, []), [activeId]);
  const { attachments, previewId, panelRef, addPastedText, pickFiles, addBlobs, togglePreview, removeAttachment, clearAttachments } =
    useAttachmentComposer({ attachments: composerDraft.attachments, updateAttachments, scopeKey: activeId });
  const exchanges = useMemo(() => toExchanges(messages), [messages]);
  const questions = useMemo(() => exchanges.map(exchange => exchange.question?.content).filter((content): content is string => !!content).reverse(), [exchanges]);
  const composer = useChatComposer({
    questions, draft, setDraft: useChatStore.getState().setDraft, send: useChatStore.getState().send,
    sending, queueWhileSending: true, isSession: ready && !loadError, attachments, clearAttachments,
    conversationId: activeId, references, clearReferences, value: composerDraft.text, onTextChange: setText, scopeKey: activeId,
  });
  const environmentOptions = useExecutionTerminalOptions(environment);
  /** Create the terminal the new-tab panel returned and bind this conversation to it. */
  const createTerminalTab = (spec: TerminalSpec) => {
    const paneId = createExecutionTerminal(spec);
    if (paneId) useChatStore.getState().setEnvironment(activeId, environmentForPane(paneId));
  };

  useEffect(() => { void useChatStore.getState().loadConversations(); }, []);
  useEffect(() => {
    if (!conversationId) return;
    let disposed = false;
    setScopeLoadError('');
    void useChatStore.getState().ensureConversationMessages(conversationId).catch(reason => { if (!disposed) setScopeLoadError(String(reason)); });
    return () => { disposed = true; };
  }, [conversationId]);
  useEffect(() => { setSettingsMenu(null); }, [active, workspace, activeId]);
  useEffect(() => { if (!active) setNewTabOpen(false); }, [active]);
  useEffect(() => {
    if (!inSidebar) return;
    sidebarSettings?.suspend(newTabOpen);
    return () => sidebarSettings?.suspend(false);
  }, [inSidebar, newTabOpen, sidebarSettings?.suspend]);
  const submit = () => {
    if (!composer.canSend) return;
    jumpToLatest();
    composer.submit();
  };
  const actions = <>
    <IconButton compact aria-label={t('Conversation settings')} data-tip={t('Conversation settings')}
      aria-haspopup="dialog" aria-expanded={settingsOpen} aria-controls={settingsOpen ? 'chat-conversation-settings' : undefined} onClick={event => {
        const trigger = event.currentTarget; const bounds = trigger.getBoundingClientRect();
        setSettingsMenu(current => current ? null : { x: bounds.right - 320, y: bounds.bottom + 4, trigger });
      }}><SlidersHorizontal size={16} /></IconButton>
  </>;
  const settingsContents = <section id="chat-conversation-settings" className="chat-conversation-settings" aria-label={inSidebar ? undefined : t('Conversation settings')} data-workspace-focus={inSidebar ? 'ai-side' : 'ai'}>
      {!workspace && !inSidebar && <div className="chat-setting-row"><span>{t('Recent conversations')}</span>
        <Select aria-label={t('Restore recent conversation')} value={activeId} disabled={loading}
          options={[...conversations].sort((first, second) => second.updatedAt - first.updatedAt).filter((item, index) => index < 20 || item.id === activeId).map(item => ({ value: item.id, label: item.title || t('Untitled') }))}
          onChange={id => { void useChatStore.getState().selectConversation(id); setSettingsMenu(null); }} />
      </div>}
      <div className="chat-setting-row"><span>{t('Execution terminal')}</span>
        <Select aria-label={t('Select execution environment')} data-testid="chat-execution-target"
          data-tip-description={environmentOptions.find(option => option.value === (environment?.paneId ?? ''))?.description}
          value={environment?.paneId ?? ''} options={environmentOptions} disabled={!ready || sending}
          action={{ label: t('New tab'), onSelect: bounds => { setNewTabAnchor(bounds ? { x: bounds.left, y: bounds.bottom + 4, aboveY: bounds.top } : undefined); setNewTabOpen(true); } }}
          onChange={paneId => useChatStore.getState().setEnvironment(activeId, paneId ? environmentForPane(paneId) : null)} />
      </div>
      {!inSidebar && <ConversationSettingsActions conversationId={activeId} onCloseMenu={() => setSettingsMenu(null)} />}
    </section>;
  return <div ref={panelRef} className="ai-chat-panel">
    {!inSidebar && (workspace ? toolbarTarget && createPortal(actions, toolbarTarget) : <ConversationHeading title={conversation?.title ?? t('AI chat')}
      onRename={conversation ? title => useChatStore.getState().renameConversation(activeId, title) : undefined}
      onHistory={() => useSessionStore.getState().openAiHistoryTab()} onNew={() => useChatStore.getState().createConversation()} settings={actions} />)}
    {inSidebar ? sidebarSettings?.target && createPortal(settingsContents, sidebarSettings.target)
      : settingsMenu && <SettingsPopover anchor={settingsMenu} label={t('Conversation settings')} onClose={() => setSettingsMenu(null)} suspended={newTabOpen}>{settingsContents}</SettingsPopover>}
    {environment && !sessions[environment.paneId] && <div className="chat-environment-note">{t('Terminal disconnected. Select a terminal to continue execution.')}</div>}
    {loadError && <ErrorBox compact actions={<OutlineButton onClick={() => {
      if (!useChatStore.getState().conversationsLoaded) void useChatStore.getState().loadConversations();
      else if (activeId) {
        useChatStore.setState({ conversationError: null });
        void useChatStore.getState().ensureConversationMessages(activeId).then(() => setScopeLoadError('')).catch(reason => setScopeLoadError(String(reason)));
      }
    }}>{t('Retry')}</OutlineButton>}>{t('Could not load conversations')}: {loadError}</ErrorBox>}
    {persistenceError && <ErrorBox compact actions={<OutlineButton onClick={() => void useChatStore.getState().retryPersistence().catch(() => {})}>{t('Retry saving')}</OutlineButton>}>
      {t('Conversation changes have not been saved')}
    </ErrorBox>}
    {/* Streaming content must never yank the view away from what is being read: any upward
        scroll input pauses the follow, even one too small to leave the "near the bottom"
        window, while a nested scroller that consumes the wheel leaves it alone. */}
    <div className="chat-transcript-wrap" style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
    <div ref={scrollRef} className="chat-transcript scroll-region" onScroll={onScroll} onWheel={onWheel} onTouchMove={onTouchMove}
      onClickCapture={event => { if ((event.target as Element).closest('button[aria-expanded]')) pauseFollow(); }}>
      <div>
        {exchanges.length ? exchanges.map(exchange => <AiBlock key={exchange.id} exchange={exchange} conversationId={activeId} presentation="conversation" />)
          : (!workspace || inSidebar) && <div className="chat-empty"><Sparkles size={26} /><strong>{t('What would you like to work on?')}</strong>
            <span>{loading ? t('Loading conversations…') : t('Ask a question, attach a file, or bring in terminal output.')}</span></div>}
      </div>
    </div>
    {/* Always in the layout on purpose: a slot that comes and goes with the follow state changes the
        transcript's height, and then the content and this button trade places on every scroll event —
        that loop is what made the bottom of the panel jump. Only the slot's visibility changes. */}
    <div className="chat-jump-slot" data-active={following ? undefined : 'true'} style={{ visibility: following ? 'hidden' : 'visible' }} aria-hidden={following}>
      <button type="button" data-subtle className="chat-jump-latest" aria-label={t('Jump to latest reply')}
        data-tip={t('Jump to latest reply')} onClick={jumpToLatest}><ArrowDown size={16} /></button>
    </div>
    </div>
    <ChatComposerShell heading={t('AI chat')} hints={<><KeyHint shortcut="Enter" />{t('Send')}</>}
      tray={<><QueuedMessages messages={queuedSends} onCancel={id => useChatStore.getState().cancelQueuedSend(id)} />
        {(references.length > 0 || attachments.length > 0) && <div className="chat-context-tray" aria-label={t('Conversation context')}>
          {attachments.length > 0 && <AttachmentChips atts={attachments} previewId={previewId} onPreview={togglePreview} onRemove={removeAttachment} />}
          {references.length > 0 && <TerminalReferences references={references} onRemove={id => {
            useComposerDrafts.getState().setReferences(activeId, references.filter(reference => reference.id !== id));
          }} />}
        </div>}</>}
      status={<>
          <IconButton aria-label={t('Add attachment')} data-tip={t('Add attachment')} onClick={() => void pickFiles()}><Plus size={18} /></IconButton>
          <ChatModeSelect />
          <span className="chat-footer-space" />
          <ModelPill showThinking={false} />
          {sending && composer.canSend && <IconButton compact aria-label={t('Queue message')} data-tip={t('Queue message')} onClick={submit}><ArrowUp size={18} /></IconButton>}
          {sending ? <IconButton className="chat-send-button" tone="accent" aria-label={t('Stop generating')} data-tip={t('Stop generating')} data-tip-description={t('Stopping also cancels queued messages for this conversation.')}
            onClick={() => useChatStore.getState().abortStream(activeId)}><Square size={15} fill="currentColor" /></IconButton>
            : <IconButton className="chat-send-button" tone="accent" aria-label={t('Send')} data-tip={t('Send')} data-tip-shortcut="Enter" onClick={submit} disabled={!composer.canSend}><ArrowUp size={18} /></IconButton>}
      </>}>
          <TextArea ref={composer.inputRef} data-chat-composer value={composer.text} placeholder={t('Describe what you want to do…')} rows={1}
            onChange={composer.handleChange} onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
              else composer.handleKeyDown(event);
            }} onPaste={event => {
              const files = Array.from(event.clipboardData.files);
              if (files.length) { event.preventDefault(); void addBlobs(files); return; }
              if (addPastedText(event.clipboardData.getData('text/plain'))) event.preventDefault();
            }} />
    </ChatComposerShell>
    {newTabOpen && <NewTabModal open anchor={newTabAnchor} onClose={() => setNewTabOpen(false)} onPick={createTerminalTab} />}
  </div>;
}
