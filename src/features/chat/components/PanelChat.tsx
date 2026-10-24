import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@i18n';
import { TextArea } from '@ui/fields/TextInput';
import InlineRenameInput from '@ui/fields/InlineRenameInput';
import KeyHint from '@ui/feedback/KeyHint';
import Select from '@ui/fields/Select';
import ErrorBox from '@ui/feedback/ErrorBox';
import { IconButton } from '@ui/actions/IconButton';
import ContextMenu, { type MenuAnchor } from '@ui/menus/ContextMenu';
import { ArrowDown, ArrowUp, History, Plus, SlidersHorizontal, Sparkles, Square, Zap } from '@ui/icons';
import { useAttachmentComposer } from '@features/agent';
import { useSessionStore } from '@features/workspace';
import { leaves, type TerminalSpec } from '@features/workspace/model/windowLayout';
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
import { environmentForPane, showExecutionTerminal } from '../services/conversationContext';
import { firstTerminalOf, isSessionTab } from '@features/workspace';
import type { ShellType } from '@platform/shells';
import type { AttachmentMeta } from '@features/agent/model/attachments';
import { useTranscriptFollow } from '../hooks/useTranscriptFollow';
import ChatComposerShell from './ChatComposerShell';

const EMPTY_MESSAGES: ChatMessage[] = [];

/** Conversation navigation, references and execution stay independent of terminal focus. */
export default function PanelChat({ active = true, workspace = false, toolbarTarget, conversationId }: { active?: boolean; workspace?: boolean; toolbarTarget?: HTMLElement | null; conversationId?: string }) {
  const activeId = useChatStore(state => conversationId ?? state.activeConversationId);
  const conversations = useChatStore(state => state.conversations);
  const messages = useChatStore(state => state.byTab[activeId] ?? EMPTY_MESSAGES);
  const ready = useChatStore(state => !!activeId && activeId in state.byTab);
  const sendingTab = useChatStore(state => state.sendingTab);
  const loading = useChatStore(state => state.conversationsLoading);
  const storeLoadError = useChatStore(state => state.conversationError);
  const [scopeLoadError, setScopeLoadError] = useState('');
  const loadError = scopeLoadError || storeLoadError;
  const persistenceError = useChatStore(state => state.persistenceError);
  const conversation = conversations.find(item => item.id === activeId);
  const environment = conversation?.environment;
  const sessions = useTerminalStore(state => state.sessions);
  const startupStates = useTerminalStore(state => state.startupStates);
  const tabs = useSessionStore(state => state.tabs);
  const terminalCwds = useSessionStore(state => state.terminalCwds);
  const [renaming, setRenaming] = useState(false);
  const [newTabOpen, setNewTabOpen] = useState(false);
  const [title, setTitle] = useState('');
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
    sending: sendingTab !== null, isSession: ready && !loadError, attachments, clearAttachments,
    conversationId: activeId, references, clearReferences, value: composerDraft.text, onTextChange: setText, scopeKey: activeId,
  });
  const environmentOptions = useMemo((): Array<{ value: string; label: string; triggerLabel?: string; description?: string; swatch?: string; disabled?: boolean }> => {
    const available = tabs.flatMap(tab => tab.kind === 'session' ? leaves(tab.layout).map((pane, index, panes) => ({ pane, tab, index, count: panes.length })) : [])
      .filter(({ pane }) => !!sessions[pane.id]).map(({ pane, tab, index, count }) => {
        const context = environmentForPane(pane.id)!;
        const triggerLabel = pane.kind === 'ssh' ? pane.ssh?.host || pane.ssh?.name || context.label : t('Local terminal');
        const host = pane.kind === 'ssh' ? pane.ssh?.host : undefined;
        const hostLabel = host && !context.label.includes(host) ? ` · ${host}` : '';
        const name = `${tab.title}${count > 1 ? ` · ${t('Pane {{number}}', { number: index + 1 })}` : ''}`;
        const swatch = startupStates[pane.id] === 'starting' ? 'var(--accent-warm)'
          : startupStates[pane.id] === 'failed' || startupStates[pane.id] === 'closed' ? 'var(--error)' : 'var(--text-secondary)';
        return { value: pane.id, label: name, triggerLabel, description: `${context.label}${hostLabel}${context.cwd ? ` · ${context.cwd}` : ''}`, swatch };
      });
    return [
      { value: '', label: t('Discussion only'), triggerLabel: t('Discussion'), swatch: 'var(--text-muted)' },
      ...(environment && !available.some(option => option.value === environment.paneId)
        ? [{ value: environment.paneId, label: `${environment.label} · ${t('Disconnected')}`, swatch: 'var(--accent-warm)', disabled: true }] : []),
      ...available,
    ];
  }, [tabs, sessions, startupStates, terminalCwds, environment]);
  /** Create the terminal the new-tab panel returned and bind this conversation to it. */
  const createTerminalTab = (spec: TerminalSpec) => {
    const store = useSessionStore.getState();
    const tabId = spec.kind === 'ssh' && spec.ssh
      ? store.addTab({ kind: 'ssh', ssh: spec.ssh })
      // The panel only ever returns a real shell id here; TerminalSpec keeps the field loose.
      : store.addTab({ shellType: spec.shellType as ShellType | undefined });
    const tab = useSessionStore.getState().tabs.find(item => item.id === tabId);
    const paneId = tab && isSessionTab(tab) ? firstTerminalOf(tab)?.id : undefined;
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
  useEffect(() => { setRenaming(false); }, [activeId]);
  useEffect(() => { setSettingsMenu(null); }, [active, workspace, activeId]);
  const submit = () => {
    if (!composer.canSend) return;
    jumpToLatest();
    composer.submit();
  };
  const commitTitle = () => {
    useChatStore.getState().renameConversation(activeId, title);
    setRenaming(false);
  };
  const actions = <>
    {!workspace && <IconButton compact aria-label={t('AI conversation history')} data-tip={t('AI conversation history')}
      onClick={() => useSessionStore.getState().openAiHistoryTab()}><History size={16} /></IconButton>}
    {!workspace && <IconButton compact aria-label={t('New conversation')} data-tip={t('New conversation')}
      onClick={() => useChatStore.getState().createConversation()}><Plus size={16} /></IconButton>}
    <IconButton compact aria-label={t('Conversation settings')} data-tip={t('Conversation settings')}
      aria-haspopup="menu" aria-expanded={settingsOpen} aria-controls={settingsOpen ? 'chat-conversation-settings' : undefined} onClick={event => {
        const trigger = event.currentTarget; const bounds = trigger.getBoundingClientRect();
        setSettingsMenu(current => current ? null : { x: bounds.right - 320, y: bounds.bottom + 4, trigger });
      }}><SlidersHorizontal size={16} /></IconButton>
  </>;
  return <div ref={panelRef} className="ai-chat-panel">
    {workspace && toolbarTarget ? createPortal(actions, toolbarTarget) : <div className="chat-conversation-heading">
      {renaming ? <InlineRenameInput autoFocus aria-label={t('Conversation title')} value={title} onChange={event => setTitle(event.target.value)}
        onFocus={event => event.currentTarget.select()} onClick={event => event.stopPropagation()}
        onBlur={commitTitle} onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'Enter') commitTitle();
          if (event.key === 'Escape') setRenaming(false);
        }} /> : <button type="button" data-subtle className="chat-conversation-title" data-tip={t('Rename conversation')} aria-label={t('Rename conversation')}
          onClick={() => { setTitle(conversation?.title ?? ''); setRenaming(true); }} disabled={!conversation}>
          {conversation?.title ?? t('AI chat')}
        </button>}
      <div className="chat-conversation-actions">{actions}</div>
    </div>}
    {settingsMenu && <ContextMenu anchor={settingsMenu} label={t('Conversation settings')} onClose={() => setSettingsMenu(null)} items={[]} header={
    <section id="chat-conversation-settings" className="chat-conversation-settings" aria-label={t('Conversation settings')} data-workspace-focus="ai">
      {!workspace && <div className="chat-setting-row"><span>{t('Recent conversations')}</span>
        <Select aria-label={t('Restore recent conversation')} value={activeId} disabled={loading}
          options={[...conversations].sort((first, second) => second.updatedAt - first.updatedAt).filter((item, index) => index < 20 || item.id === activeId).map(item => ({ value: item.id, label: item.title || t('Untitled') }))}
          onChange={id => { void useChatStore.getState().selectConversation(id); setSettingsMenu(null); }} />
      </div>}
      <div className="chat-setting-row"><span>{t('Execution terminal')}</span>
        <Select aria-label={t('Select execution environment')} data-testid="chat-execution-target"
          data-tip-description={environmentOptions.find(option => option.value === (environment?.paneId ?? ''))?.description}
          value={environment?.paneId ?? ''} options={environmentOptions} disabled={!ready || sendingTab === activeId}
          action={{ label: t('New tab'), onSelect: () => { setSettingsMenu(null); setNewTabOpen(true); } }}
          onChange={paneId => useChatStore.getState().setEnvironment(activeId, paneId ? environmentForPane(paneId) : null)} />
      </div>
      <div className="chat-setting-links">
        {environment && !!sessions[environment.paneId] && <button type="button" data-subtle onClick={() => { setSettingsMenu(null); showExecutionTerminal(environment.paneId); }}>{t('View terminal')}</button>}
        <button type="button" data-subtle data-testid="chat-usage-entry" onClick={() => { setSettingsMenu(null); useSessionStore.getState().openUsageTab(); }}>{t('Usage statistics')}</button>
        <button type="button" data-subtle onClick={() => { setSettingsMenu(null); useSessionStore.getState().openSettings(); }}>{t('Open settings')}</button>
      </div>
    </section>} />}
    {environment && <div className="chat-conversation-context" data-testid="chat-conversation-context">
      <span className="chat-terminal-status" style={{ background: environmentOptions.find(option => option.value === environment.paneId)?.swatch }} aria-hidden="true" />
      <span>{environmentOptions.find(option => option.value === environment.paneId)?.triggerLabel ?? environment.label}</span>
      {!sessions[environment.paneId] && <span>{t('Disconnected')}</span>}
    </div>}
    {environment && !sessions[environment.paneId] && <div className="chat-environment-note">{t('Terminal disconnected. Select a terminal to continue execution.')}</div>}
    {loadError && <ErrorBox compact actions={<button onClick={() => {
      if (!useChatStore.getState().conversationsLoaded) void useChatStore.getState().loadConversations();
      else if (activeId) {
        useChatStore.setState({ conversationError: null });
        void useChatStore.getState().ensureConversationMessages(activeId).then(() => setScopeLoadError('')).catch(reason => setScopeLoadError(String(reason)));
      }
    }}>{t('Retry')}</button>}>{t('Could not load conversations')}: {loadError}</ErrorBox>}
    {persistenceError && <ErrorBox compact actions={<button onClick={() => void useChatStore.getState().retryPersistence().catch(() => {})}>{t('Retry saving')}</button>}>
      {t('Conversation changes have not been saved')}
    </ErrorBox>}
    {sendingTab && sendingTab !== activeId && <div className="chat-background-task">
      <span>{t('Another conversation is working')}</span>
      <button type="button" data-subtle onClick={() => { void useChatStore.getState().selectConversation(sendingTab); }}>{t('View')}</button>
    </div>}
    {/* Streaming content must never yank the view away from what is being read: any upward
        scroll input pauses the follow, even one too small to leave the "near the bottom"
        window, while a nested scroller that consumes the wheel leaves it alone. */}
    <div className="chat-transcript-wrap" style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
    <div ref={scrollRef} className="chat-transcript scroll-region" onScroll={onScroll} onWheel={onWheel} onTouchMove={onTouchMove}
      onClickCapture={event => { if ((event.target as Element).closest('button[aria-expanded]')) pauseFollow(); }}>
      <div>
        {exchanges.length ? exchanges.map(exchange => <AiBlock key={exchange.id} exchange={exchange} conversationId={activeId} presentation="conversation" />)
          : !workspace && <div className="chat-empty"><Sparkles size={26} /><strong>{t('What would you like to work on?')}</strong>
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
      tray={(references.length > 0 || attachments.length > 0) && <div className="chat-context-tray" aria-label={t('Conversation context')}>
          {attachments.length > 0 && <AttachmentChips atts={attachments} previewId={previewId} onPreview={togglePreview} onRemove={removeAttachment} />}
          {references.length > 0 && <TerminalReferences references={references} onRemove={id => {
            useComposerDrafts.getState().setReferences(activeId, references.filter(reference => reference.id !== id));
          }} />}
        </div>}
      status={<>
          <IconButton aria-label={t('Add attachment')} data-tip={t('Add attachment')} onClick={() => void pickFiles()}><Plus size={18} /></IconButton>
          <ChatModeSelect />
          <span className="chat-footer-space" />
          <ModelPill showThinking={false} />
          {sendingTab === activeId ? <IconButton className="chat-send-button" tone="accent" aria-label={t('Stop generating')} data-tip={t('Stop generating')}
            onClick={() => useChatStore.getState().abortStream(activeId)}><Square size={15} fill="currentColor" /></IconButton>
            : <IconButton className="chat-send-button" tone="accent" aria-label={t('Send')} data-tip={t('Send')} data-tip-shortcut="Enter" onClick={submit} disabled={!composer.canSend}><ArrowUp size={18} /></IconButton>}
      </>}>
          <Zap size={20} aria-hidden="true" className="chat-composer-lead" />
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
    {newTabOpen && <NewTabModal open onClose={() => setNewTabOpen(false)} onPick={createTerminalTab} />}
  </div>;
}
