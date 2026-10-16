import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { t } from '@i18n';
import { TextArea, TextInput } from '@ui/TextInput';
import KeyHint from '@ui/KeyHint';
import Select from '@ui/Select';
import ErrorBox from '@ui/ErrorBox';
import { IconButton } from '@ui/IconButton';
import { ArrowDown, ArrowUp, History, Plus, SlidersHorizontal, Sparkles, Square, Zap } from '@ui/icons';
import { useAttachmentComposer } from '@features/agent';
import { useSessionStore } from '@features/workspace';
import { leaves } from '@features/workspace/model/windowLayout';
import { useTerminalStore } from '@features/terminal';
import { useChatStore, type ChatMessage } from '../stores/chat';
import { EMPTY_COMPOSER_DRAFT, useComposerDrafts } from '../stores/composerDrafts';
import ChatModeSelect from './ChatModeSelect';
import ChatComposerShell from './ChatComposerShell';
import ModelPill from './ModelPill';
import AttachmentChips from './AttachmentChips';
import TerminalReferences from './TerminalReferences';
import AiBlock from './AiBlock';
import { toExchanges } from '../model/exchanges';
import { useChatComposer } from '../hooks/useChatComposer';
import { environmentForPane, showExecutionTerminal } from '../services/conversationContext';
import { useIconColorStore } from '@config/iconColors';
import { tabIconColor } from '@features/workspace';
import type { AttachmentMeta } from '@features/agent/model/attachments';

const EMPTY_MESSAGES: ChatMessage[] = [];

/**
 * True when a scroll surface between the wheel target and the transcript can absorb the
 * upward scroll itself, so the wheel never reaches the transcript and must not pause it.
 */
function innerScrollerHoldsUpward(target: EventTarget | null, boundary: Element): boolean {
  for (let node = target instanceof HTMLElement ? target : null; node && node !== boundary; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollTop > 0) return true;
  }
  return false;
}

/** Conversation navigation, references and execution stay independent of terminal focus. */
export default function PanelChat() {
  const activeId = useChatStore(state => state.activeConversationId);
  const conversations = useChatStore(state => state.conversations);
  const messages = useChatStore(state => state.byTab[activeId] ?? EMPTY_MESSAGES);
  const ready = useChatStore(state => !!activeId && activeId in state.byTab);
  const sendingTab = useChatStore(state => state.sendingTab);
  const loading = useChatStore(state => state.conversationsLoading);
  const loadError = useChatStore(state => state.conversationError);
  const persistenceError = useChatStore(state => state.persistenceError);
  const conversation = conversations.find(item => item.id === activeId);
  const environment = conversation?.environment;
  const sessions = useTerminalStore(state => state.sessions);
  const startupStates = useTerminalStore(state => state.startupStates);
  const tabs = useSessionStore(state => state.tabs);
  const iconColors = useIconColorStore(state => state.colors);
  const terminalCwds = useSessionStore(state => state.terminalCwds);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const [following, setFollowing] = useState(true);
  const followRef = useRef(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, { top: number; following: boolean }>());
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
  const environmentOptions = useMemo(() => {
    const available = tabs.flatMap(tab => tab.kind === 'session' ? leaves(tab.layout).map(pane => ({ pane, tab })) : [])
      .filter(({ pane }) => !!sessions[pane.id]).map(({ pane, tab }) => {
        const context = environmentForPane(pane.id)!;
        const triggerLabel = pane.kind === 'ssh' ? pane.ssh?.host || pane.ssh?.name || context.label : t('Local terminal');
        const host = pane.kind === 'ssh' ? pane.ssh?.host : undefined;
        const hostLabel = host && !context.label.includes(host) ? ` · ${host}` : '';
        const swatch = startupStates[pane.id] === 'starting' ? 'var(--accent-warm)'
          : startupStates[pane.id] === 'failed' || startupStates[pane.id] === 'closed' ? 'var(--error)' : tabIconColor(tab, iconColors, pane) ?? 'var(--success)';
        return { value: pane.id, label: `${context.label}${hostLabel}${context.cwd ? ` · ${context.cwd}` : ''}`, triggerLabel, swatch };
      });
    return [
      { value: '', label: t('Discussion only'), triggerLabel: t('Discussion'), swatch: 'var(--text-muted)' },
      ...(environment && !available.some(option => option.value === environment.paneId)
        ? [{ value: environment.paneId, label: `${environment.label} · ${t('Disconnected')}`, swatch: 'var(--accent-warm)', disabled: true }] : []),
      ...available,
    ];
  }, [tabs, sessions, startupStates, terminalCwds, environment, iconColors]);

  useEffect(() => { void useChatStore.getState().loadConversations(); }, []);
  useEffect(() => { setRenaming(false); }, [activeId]);
  /** Where the app last put the view. A scroll event that lands anywhere else came from the reader,
   *  and while that is true the app must not touch the position: fighting a held scrollbar is the
   *  shake. The follow comes back only once the position has settled at the bottom. */
  const lastTopRef = useRef(0);
  const settleRef = useRef<number | null>(null);
  useEffect(() => () => { if (settleRef.current !== null) window.clearTimeout(settleRef.current); }, []);
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const saved = positions.current.get(activeId);
    followRef.current = saved?.following ?? true;
    setFollowing(followRef.current);
    scroll.scrollTop = saved?.following === false ? saved.top : scroll.scrollHeight;
    lastTopRef.current = scroll.scrollTop;
    return () => { positions.current.set(activeId, { top: scroll.scrollTop, following: followRef.current }); };
  }, [activeId]);
  useLayoutEffect(() => {
    if (followRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      lastTopRef.current = scrollRef.current.scrollTop;
    }
  }, [messages]);
  // Nothing scrolls from a resize callback on purpose: growing content and the app both moving the
  // view is what made the transcript jump, and the browser's scroll anchoring (disabled for this
  // element in the stylesheet) was a third hand on the same scrollbar. New messages pin the view
  // when it is following, and nothing else writes a scroll position.
  const submit = () => {
    if (!composer.canSend) return;
    followRef.current = true;
    setFollowing(true);
    composer.submit();
  };
  /** Drop the follow so streamed content stops moving the view the user is reading. */
  const pauseFollow = () => {
    followRef.current = false;
    setFollowing(false);
  };
  const commitTitle = () => {
    useChatStore.getState().renameConversation(activeId, title);
    setRenaming(false);
  };
  return <div ref={panelRef} className="ai-chat-panel">
    <div className="chat-conversation-heading">
      {renaming ? <TextInput autoFocus className="inline-rename-input" aria-label={t('Conversation title')} value={title} onChange={event => setTitle(event.target.value)}
        onFocus={event => event.currentTarget.select()} onClick={event => event.stopPropagation()}
        onBlur={commitTitle} onKeyDown={event => {
          if (event.key === 'Enter') commitTitle();
          if (event.key === 'Escape') setRenaming(false);
        }} /> : <button type="button" data-subtle className="chat-conversation-title" data-tip={t('Rename conversation')} aria-label={t('Rename conversation')}
          onClick={() => { setTitle(conversation?.title ?? ''); setRenaming(true); }} disabled={!conversation}>
          {conversation?.title ?? t('AI chat')}
        </button>}
      <IconButton compact aria-label={t('AI conversation history')} data-tip={t('AI conversation history')}
        onClick={() => useSessionStore.getState().openAiHistoryTab()}><History size={16} /></IconButton>
      <IconButton compact aria-label={t('New conversation')} data-tip={t('New conversation')}
        onClick={() => useChatStore.getState().createConversation()}><Plus size={16} /></IconButton>
      <IconButton ref={settingsTrigger} compact aria-label={t('Conversation settings')} data-tip={t('Conversation settings')}
        aria-expanded={settingsOpen} aria-controls="chat-conversation-settings" onClick={() => setSettingsOpen(!settingsOpen)}>
        <SlidersHorizontal size={16} />
      </IconButton>
    </div>
    {settingsOpen && <section id="chat-conversation-settings" className="chat-conversation-settings" aria-label={t('Conversation settings')}
      onKeyDown={event => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.stopPropagation(); setSettingsOpen(false); settingsTrigger.current?.focus();
        }
      }}>
      <div className="chat-setting-row"><span>{t('Execution terminal')}</span>
        <Select aria-label={t('Select execution environment')} data-testid="chat-execution-target"
          data-tip-description={environmentOptions.find(option => option.value === (environment?.paneId ?? ''))?.label}
          value={environment?.paneId ?? ''} options={environmentOptions} disabled={!ready || sendingTab === activeId}
          onChange={paneId => useChatStore.getState().setEnvironment(activeId, paneId ? environmentForPane(paneId) : null)} />
      </div>
      <div className="chat-setting-links">
        {environment && !!sessions[environment.paneId] && <button type="button" data-subtle onClick={() => showExecutionTerminal(environment.paneId)}>{t('View terminal')}</button>}
        <button type="button" data-subtle data-testid="chat-usage-entry" onClick={() => useSessionStore.getState().openUsageTab()}>{t('Usage')}</button>
        <button type="button" data-subtle data-testid="chat-harness-entry" onClick={() => useSessionStore.getState().openHarnessHubTab()}>{t('Harness')}</button>
        <button type="button" data-subtle onClick={() => useSessionStore.getState().openSettingsTab()}>{t('Open settings')}</button>
      </div>
    </section>}
    {environment && <div className="chat-conversation-context" data-testid="chat-conversation-context">
      <span className="chat-terminal-status" style={{ background: environmentOptions.find(option => option.value === environment.paneId)?.swatch }} aria-hidden="true" />
      <span>{environmentOptions.find(option => option.value === environment.paneId)?.triggerLabel ?? environment.label}</span>
      {!sessions[environment.paneId] && <span>{t('Disconnected')}</span>}
    </div>}
    {environment && !sessions[environment.paneId] && <div className="chat-environment-note">{t('Terminal disconnected. Select a terminal to continue execution.')}</div>}
    {loadError && <ErrorBox compact actions={<button onClick={() => {
      if (!useChatStore.getState().conversationsLoaded) void useChatStore.getState().loadConversations();
      else if (activeId) void useChatStore.getState().selectConversation(activeId);
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
    <div ref={scrollRef} className="chat-transcript scroll-region" onScroll={event => {
      const scroll = event.currentTarget;
      const ours = Math.abs(scroll.scrollTop - lastTopRef.current) <= 1;
      lastTopRef.current = scroll.scrollTop;
      // Our own jump: nothing to decide.
      if (ours) return;
      // The reader moved the view, by any means, including a scrollbar drag that fires no wheel.
      pauseFollow();
      // Only an exact return to the bottom hands the follow back: a small wheel or trackpad
      // nudge upward stays paused while content keeps streaming.
      const atBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight <= 4;
      if (settleRef.current !== null) window.clearTimeout(settleRef.current);
      settleRef.current = null;
      if (!atBottom) return;
      // Stopped at the bottom: hand the follow back, but only after the movement has stopped.
      settleRef.current = window.setTimeout(() => {
        settleRef.current = null;
        followRef.current = true;
        setFollowing(true);
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          lastTopRef.current = scrollRef.current.scrollTop;
        }
      }, 160);
    }}
      onWheel={event => {
        if (event.deltaY < 0 && !innerScrollerHoldsUpward(event.target, event.currentTarget)) pauseFollow();
      }}
      onTouchMove={pauseFollow}>
      <div ref={transcriptRef}>
        {exchanges.length ? exchanges.map(exchange => <AiBlock key={exchange.id} exchange={exchange} conversationId={activeId} presentation="conversation" />)
          : <div className="chat-empty"><Sparkles size={26} /><strong>{t('What would you like to work on?')}</strong>
            <span>{loading ? t('Loading conversations…') : t('Ask a question, attach a file, or bring in terminal output.')}</span></div>}
      </div>
    </div>
    {/* Always in the layout on purpose: a slot that comes and goes with the follow state changes the
        transcript's height, and then the content and this button trade places on every scroll event —
        that loop is what made the bottom of the panel jump. Only the slot's visibility changes. */}
    <div className="chat-jump-slot" data-active={following ? undefined : 'true'} style={{ visibility: following ? 'hidden' : 'visible' }} aria-hidden={following}>
      <button type="button" data-subtle className="chat-jump-latest" aria-label={t('Jump to latest reply')}
        data-tip={t('Jump to latest reply')} onClick={() => {
        followRef.current = true; setFollowing(true);
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          lastTopRef.current = scrollRef.current.scrollTop;
        }
      }}><ArrowDown size={16} /></button>
    </div>
    </div>
    <ChatComposerShell
      heading={<>{t('AI chat')}</>}
      hints={<><KeyHint shortcut="Enter" />{t('Send')}</>}
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
      </>}
    >
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
  </div>;
}
