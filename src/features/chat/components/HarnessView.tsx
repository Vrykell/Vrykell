/**
 * HarnessView — the workspace page of one external harness session.
 *
 * The transcript is the same component the AI panel uses (`AiBlock` over `ChatExchange`s), so a
 * harness session reads like every other conversation in the app. Everything that could decide
 * something (approvals, the process, the protocol) happens in Rust; this page sends the user's
 * intent and renders what comes back.
 */
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@i18n';
import HarnessQuestion from './HarnessQuestion';
import { ArrowDown, ArrowUp, Plus, SlidersHorizontal, Sparkles, Square, iconSizes } from '@ui/icons';
import { useListNavigationMode } from '@ui/hooks/useListNavigationMode';
import { useAutoSizeTextarea } from '@ui/hooks/useAutoSizeTextarea';
import { IconButton } from '@ui/actions/IconButton';
import ErrorBox from '@ui/feedback/ErrorBox';
import { useToastStore } from '@ui/feedback/Toast';
import { TextArea } from '@ui/fields/TextInput';
import Select from '@ui/fields/Select';
import SettingsPopover from '@ui/menus/SettingsPopover';
import type { MenuAnchor } from '@ui/menus/ContextMenu';
import KeyHint from '@ui/feedback/KeyHint';
import { formatCompact } from '@features/agent/model/usageStats';
import { useAttachmentComposer } from '@features/agent/hooks/useAttachmentComposer';
import type { AttachmentMeta } from '@features/agent/model/attachments';
import { useComposerDrafts, EMPTY_COMPOSER_DRAFT } from '../stores/composerDrafts';
import { useHarnessWorkspace } from '../stores/harnessWorkspace';
import { useAiWorkspace } from '../stores/aiWorkspace';
import { useWorkspaceNavigation } from '@features/workspace';
import { createSideAgent } from '../services/aiWorkspace';
import { harnessSupportsImages } from '../services/harnessAttachments';
import { useTranscriptFollow } from '../hooks/useTranscriptFollow';
import { OutlineButton } from '@ui/actions/OutlineButton';
import { toExchanges } from '@features/chat/model/exchanges';
import { groupHarnessMessages } from '../model/harnessTranscript';
import { createExecutionTerminal } from '@features/workspace/services/executionTerminal';
import NewTabModal from '@features/workspace/components/NewTabModal';
import type { DropdownAnchor } from '@ui/menus/AnchoredDropdown';
import AiBlock from '@features/chat/components/AiBlock';
import AttachmentChips from './AttachmentChips';
import ChatComposerShell from './ChatComposerShell';
import QueuedMessages from './QueuedMessages';
import HarnessSelector, { type HarnessSelectorOption } from './HarnessSelector';
import { useHarnessStore, type HarnessSession } from '../stores/harness';
import { isModelOption, isPermissionOption } from '../model/harnessOptions';
import type { AcpConfigGroup, AcpConfigValue } from '@platform/api/acp';
import { useExecutionTerminalOptions } from '../hooks/useExecutionTerminalOptions';
import { environmentForPane } from '../services/conversationContext';
import { SidebarSettingsContext } from './SidebarSettingsContext';
import { terminalDebug } from '@features/terminal/services/terminalDebug';

/** One session choice in the shared conversation settings. */
interface SessionSelector {
  key: string;
  model?: boolean;
  permission?: boolean;
  label: string;
  value: string;
  options: HarnessSelectorOption[];
  apply: (value: string) => void;
}

/** Config options first (the protocol's newer shape), then the older mode and model fields. */
function sessionSelectors(session: HarnessSession, tabId: string): SessionSelector[] {
  const store = useHarnessStore.getState();
  const selectors: SessionSelector[] = [];
  const configs = session.configOptions ?? [];
  for (const option of configs) {
    if (option.type !== 'select') continue;
    const options = flattenConfigOptions(option.options ?? []);
    if (options.length === 0) continue;
    selectors.push({
      key: `config-${option.id}`,
      model: isModelOption(option),
      permission: isPermissionOption(option),
      label: option.name,
      value: String(option.currentValue),
      options,
      apply: (value) => void store.setConfigOption(tabId, option.id, value),
    });
  }
  const hasMode = selectors.some(selector => selector.permission);
  if (!hasMode && session.modes) {
    selectors.push({
      key: 'mode',
      permission: true,
      label: t('Mode'),
      value: session.modes.currentModeId,
      options: session.modes.availableModes.map((mode) => ({
        value: mode.id, label: mode.name, description: mode.description,
      })),
      apply: (value) => void store.setMode(tabId, value),
    });
  }
  const hasModel = selectors.some(selector => selector.model);
  if (!hasModel && session.models) {
    selectors.push({
      key: 'model',
      model: true,
      label: t('Model'),
      value: session.models.currentModelId,
      options: session.models.availableModels.map((model) => ({
        value: model.modelId, label: model.name || model.modelId, description: model.description ?? undefined,
      })),
      apply: (value) => void store.setModel(tabId, value),
    });
  }
  return selectors;
}

/** Grouped select values flatten into one list; the group names add nothing to a short menu. */
function flattenConfigOptions(options: Array<AcpConfigValue | AcpConfigGroup>): HarnessSelectorOption[] {
  return options.flatMap((entry) => ('group' in entry && Array.isArray(entry.options)
    ? entry.options.map((value) => ({ value: value.value, label: value.name, description: value.description }))
    : [{
        value: (entry as AcpConfigValue).value,
        label: (entry as AcpConfigValue).name,
        description: (entry as AcpConfigValue).description,
      }]));
}

/** The login instructions an agent published, shown when a turn fails because it is not signed in. */
function authHints(agent: HarnessSession['agent']): string[] {
  const methods = agent?.authMethods;
  if (!Array.isArray(methods)) return [];
  return methods
    .map((method) => {
      const entry = (method ?? {}) as Record<string, unknown>;
      const description = typeof entry.description === 'string' ? entry.description.trim() : '';
      return description || (typeof entry.name === 'string' ? entry.name.trim() : '');
    })
    .filter((text) => text.length > 0);
}

/** The context window in use, as the agent last reported it. */
function contextLabel(context: { used: number; size: number }): string {
  return context.size > 0 ? `${formatCompact(context.used)}/${formatCompact(context.size)}` : formatCompact(context.used);
}

/**
 * A connected session reuses the conversation blocks, composer shell and transcript follow behavior.
 */
export default function HarnessView({ tabId, harness, cwd, fresh = false, active = true, resumeSessionId, toolbarTarget }: { tabId: string; harness: string; cwd?: string; fresh?: boolean; active?: boolean; resumeSessionId?: string; toolbarTarget?: HTMLElement | null }) {
  const session = useHarnessStore((state) => state.byTab[tabId]);
  const sidebarSettings = useContext(SidebarSettingsContext);
  const inSidebar = sidebarSettings?.resourceId === `acp:${tabId}`;
  const executionOptions = useExecutionTerminalOptions(session?.executionPaneId ? environmentForPane(session.executionPaneId) ?? { paneId: session.executionPaneId, kind: 'local', label: t('Disconnected') } : null);
  const composerDraft = useComposerDrafts(state => state.byTab[tabId] ?? EMPTY_COMPOSER_DRAFT);
  const text = composerDraft.text;
  const setText = useCallback((value: string) => useComposerDrafts.getState().setText(tabId, value), [tabId]);
  const updateAttachments = useCallback((update: (current: AttachmentMeta[]) => AttachmentMeta[]) => {
    useComposerDrafts.getState().updateAttachments(tabId, update);
  }, [tabId]);
  const imageSupport = harnessSupportsImages(session?.agent?.agentCapabilities);
  const agentKnown = Boolean(session?.agent);
  const acceptAttachment = useCallback((attachment: AttachmentMeta) => {
    if (attachment.textContent !== undefined) return null;
    if (!attachment.mime.startsWith('image/')) return t('This attachment cannot be sent to an ACP agent.');
    if (agentKnown && !imageSupport) return t('This agent does not accept images.');
    return null;
  }, [agentKnown, imageSupport]);
  const { attachments, previewId, panelRef, addPastedText, pickFiles, addBlobs, togglePreview, removeAttachment } =
    useAttachmentComposer({ attachments: composerDraft.attachments, updateAttachments, scopeKey: tabId, accept: acceptAttachment });
  const follow = useTranscriptFollow(tabId, session?.messages, active);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // The harness composer grows with its content exactly like the terminal and AI-chat composers:
  // same hook, same 120px cap, same internal scrolling once the cap is reached.
  useAutoSizeTextarea(composerRef, text, 120);
  const submitting = useRef(false);
  const [terminalPicker, setTerminalPicker] = useState<{ anchor?: DropdownAnchor } | null>(null);
  const [settingsMenu, setSettingsMenu] = useState<MenuAnchor | null>(null);
  useEffect(() => { setSettingsMenu(null); }, [active, inSidebar, toolbarTarget]);
  useEffect(() => { if (!active) setTerminalPicker(null); }, [active]);
  useEffect(() => {
    if (!inSidebar) return;
    sidebarSettings?.suspend(!!terminalPicker);
    return () => sidebarSettings?.suspend(false);
  }, [inSidebar, !!terminalPicker, sidebarSettings?.suspend]);
  /** Escape hides the command list for the current text without touching what was typed. */
  const [commandDismissed, setCommandDismissed] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);
  const commandNavigation = useListNavigationMode(true);
  /** The store refuses a second open for a tab that is already opening, so a re-rendered effect or a
   *  double click can only ever start one agent process. */
  useEffect(() => {
    if (session) return;
    void useHarnessStore.getState().open(tabId, harness, cwd ?? '', fresh, resumeSessionId);
  }, [tabId, harness, session, cwd, fresh, resumeSessionId]);

  const agent = session?.agent?.agentInfo;
  const exchanges = toExchanges(groupHarnessMessages(session?.messages ?? []));
  if (session?.pending && !exchanges[exchanges.length - 1]?.answer) {
    const last = exchanges[exchanges.length - 1];
    const answer = { id: `harness-waiting-${tabId}`, role: 'assistant' as const, content: '', createdAt: last?.createdAt ?? Date.now() };
    if (last) exchanges[exchanges.length - 1] = { ...last, answer };
    else exchanges.push({ id: answer.id, createdAt: answer.createdAt, answer });
  }
  const lastMessage = session?.messages[session.messages.length - 1];
  const replyErrorVisible = lastMessage?.error && lastMessage.errorSummary === session?.error;
  useEffect(() => {
    terminalDebug('harness-transcript-rendered', {
      tabId, sessionId: session?.sessionId ?? null, active, pending: session?.pending,
      messageCount: session?.messages.length ?? 0, exchangeCount: exchanges.length,
      assistantCount: session?.messages.filter(message => message.role === 'assistant').length ?? 0,
      textChars: session?.messages.reduce((count, message) => message.role === 'assistant'
        ? count + message.content.length + (message.parts?.reduce((size, part) => size + (part.kind === 'text' ? part.text.length : 0), 0) ?? 0) : count, 0) ?? 0,
      hasError: !!session?.error,
    });
  }, [tabId, session?.sessionId, session?.messages, session?.pending, session?.error, active, exchanges.length]);
  const canSend = Boolean(session) && (text.trim().length > 0 || attachments.length > 0);
  const selectors = session ? sessionSelectors(session, tabId) : [];
  const permissionSelector = selectors.find(selector => selector.permission);
  const modelSelector = selectors.find(selector => selector.model);
  const executionSelector = session?.appToolsConnected && <Select aria-label={t('Application execution terminal')} data-testid="harness-execution-target"
    value={session.executionPaneId ?? ''} options={executionOptions}
    disabled={session.pending || session.opening} onChange={paneId => useHarnessStore.getState().setExecutionPane(tabId, paneId || null)}
    action={{ label: t('New terminal'), onSelect: bounds => setTerminalPicker({ anchor: bounds ? { x: bounds.left, y: bounds.bottom + 4, aboveY: bounds.top } : undefined }) }} />;
  const hints = session?.authRequired ? authHints(session.agent) : [];
  const plan = session?.plan ?? [];
  const settingsContents = <div className="chat-conversation-settings harness-session-settings">
    {selectors.filter(selector => selector !== permissionSelector && selector !== modelSelector).map(selector => <div key={selector.key} className="chat-setting-row">
      <span>{selector.label}</span>
      <Select aria-label={selector.label} data-testid={`harness-selector-${selector.key}`} value={selector.value}
        options={selector.options} disabled={session?.pending || session?.opening}
        data-tip-description={selector.options.find(option => option.value === selector.value)?.description} onChange={selector.apply} />
    </div>)}
    {executionSelector && <div className="chat-setting-row"><span>{t('Execution terminal')}</span>{executionSelector}</div>}
    {session?.context && <div className="chat-setting-row"><span>{t('Context window in use')}</span><span data-testid="harness-context">{contextLabel(session.context)}</span></div>}
  </div>;

  // Slash commands: while the first word is still being typed, the agent's own commands are one
  // press away. Picking one only fills the composer; the command runs when the prompt is sent.
  const slash = /^\/([^\s]*)$/.exec(text);
  const matches = slash && !commandDismissed
    ? (session?.commands ?? []).filter((command) => command.name.toLowerCase().includes(slash[1]!.toLowerCase())).slice(0, 8)
    : [];
  const activeCommand = Math.min(commandIndex, Math.max(0, matches.length - 1));

  const pickCommand = (name: string) => {
    setText(`/${name} `);
    setCommandIndex(0);
    composerRef.current?.focus();
  };

  const submit = async () => {
    if (!canSend || submitting.current) return;
    const value = text;
    const pending = attachments;
    if (pending.some(attachment => attachment.textContent === undefined && !attachment.mime.startsWith('image/'))) {
      useToastStore.getState().addToast(t('This attachment cannot be sent to an ACP agent.'), 'error');
      return;
    }
    if (pending.some(attachment => attachment.mime.startsWith('image/')) && !imageSupport) {
      useToastStore.getState().addToast(t('This agent does not accept images.'), 'error');
      return;
    }
    follow.jumpToLatest();
    submitting.current = true;
    try {
      const accepted = await useHarnessStore.getState().prompt(tabId, value, pending);
      if (!accepted) return;
      const current = useComposerDrafts.getState().byTab[tabId];
      if (!current) return;
      if (current?.text === value) setText('');
      const sentIds = new Set(pending.map(attachment => attachment.id));
      updateAttachments(current => current.filter(attachment => !sentIds.has(attachment.id)));
    } finally {
      submitting.current = false;
    }
  };

  return (
    <div ref={panelRef} data-testid="harness-page" className="ai-chat-panel harness-chat-panel" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {!inSidebar && active && toolbarTarget && createPortal(<IconButton compact aria-label={t('Conversation settings')} data-tip={t('Conversation settings')}
        aria-haspopup="dialog" aria-expanded={!!settingsMenu} onClick={event => {
          const trigger = event.currentTarget; const bounds = trigger.getBoundingClientRect();
          setSettingsMenu(current => current ? null : { x: bounds.right - 320, y: bounds.bottom + 4, trigger });
        }}><SlidersHorizontal size={16} /></IconButton>, toolbarTarget)}
      {inSidebar ? sidebarSettings?.target && createPortal(settingsContents, sidebarSettings.target)
        : settingsMenu && <SettingsPopover anchor={settingsMenu} label={t('Conversation settings')} onClose={() => setSettingsMenu(null)} suspended={!!terminalPicker}>
          {settingsContents}
        </SettingsPopover>}
      <NewTabModal open={!!terminalPicker} anchor={terminalPicker?.anchor} onClose={() => setTerminalPicker(null)} onPick={spec => {
        const paneId = createExecutionTerminal(spec);
        if (paneId) useHarnessStore.getState().setExecutionPane(tabId, paneId);
        setTerminalPicker(null);
      }} />
      <div ref={follow.scrollRef} className="scroll-region chat-transcript" onScroll={follow.onScroll}
        onWheel={follow.onWheel} onTouchMove={follow.onTouchMove}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 14px 4px' }}>
        {!session && <p style={{ margin: '10px 4px', color: 'var(--text-muted)', fontSize: 'var(--fs-caption)' }}>
          {t('Opening the harness session…')}
        </p>}
        {session?.error && !replyErrorVisible && <ErrorBox title={session.sessionId ? t('The harness failed.') : t('Connection failed')}
          details={session.errorDetails ?? undefined}
          actions={!session.sessionId && <OutlineButton onClick={() => void useHarnessStore.getState().open(tabId, harness, cwd ?? '', fresh, resumeSessionId)}>{t('Retry')}</OutlineButton>}>
          {session.error}
        </ErrorBox>}
        {/* Only the protocol's authentication code gets the agent's login instructions: a quota,
            a timeout or a crash looks like a failure too, but none of them is a missing login. */}
        {session?.error && session.authRequired && hints.length > 0 && (
          <p data-testid="harness-auth-hint" style={{ margin: '2px 4px 8px', color: 'var(--text-muted)', fontSize: 'var(--fs-caption)' }}>
            {t('Log in to this agent first:')} {hints.join(' · ')}
          </p>
        )}
        {session?.note && <p data-testid="harness-note" style={{ margin: '6px 4px', color: 'var(--text-muted)', fontSize: 'var(--fs-micro)' }}>
          {session.note}
        </p>}
        {exchanges.map((exchange, index) => (
          <AiBlock key={exchange.id} exchange={exchange.answer && index === exchanges.length - 1 ? { ...exchange, answer: { ...exchange.answer, pending: session?.pending ?? false } } : exchange}
            onRetry={exchange.question && !session?.pending && !session?.opening && !session?.stopping
              ? () => { follow.jumpToLatest(); void useHarnessStore.getState().prompt(tabId, exchange.question!.content, exchange.question!.attachments); } : undefined}
            allowExchangeActions={false} toolContextId={session?.toolContextId ?? tabId} presentation="conversation" onAskAboutTool={question => {
            const drafts = useComposerDrafts.getState(); const previous = drafts.byTab[tabId]?.text;
            drafts.setText(tabId, previous ? `${previous}\n${question}` : question);
            requestAnimationFrame(() => composerRef.current?.focus());
          }} />
        ))}
        {/* The plan the agent publishes while it works, in the order it sent it. */}
        {plan.length > 0 && (
          <div data-testid="harness-plan" style={{
            margin: '10px 4px', padding: '8px 10px', border: 0,
            borderRadius: 'var(--radius-inner)', background: 'var(--card-bg)',
          }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-caption)', marginBottom: 4 }}>{t('Plan')}</div>
            {plan.map((entry, index) => (
              <div key={index} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '2px 0' }}>
                <span className="harness-plan-mark" aria-hidden="true"
                  data-state={entry.status === 'completed' ? 'done' : entry.status === 'in_progress' ? 'active' : 'todo'} />
                <span style={{
                  fontSize: 'var(--fs-label)', lineHeight: 1.5,
                  color: entry.status === 'completed' ? 'var(--text-muted)' : 'var(--text-primary)',
                  textDecoration: entry.status === 'completed' ? 'line-through' : undefined,
                }}>{entry.content}</span>
              </div>
            ))}
          </div>
        )}
        {/* The approval card sits at the end of the transcript, where the turn is: it reuses the
            app's own approval styling, and its buttons are the options the harness offered. */}
        {session?.permission && (
          <div data-testid="harness-permission" className="ai-tool-approval" style={{ margin: '10px 4px', padding: '8px 10px' }}>
            <div>{t('The harness is waiting for your decision:')} {session.permission.title}</div>
            <div className="ai-tool-approval-actions">
              {session.permission.options.map((option) => (
                <button key={option.optionId} type="button" data-testid={`harness-option-${option.optionId}`} data-subtle
                  onClick={() => void useHarnessStore.getState().answerPermission(tabId, session.permission!.generation, option.optionId)}>
                  {option.name}
                </button>
              ))}
              <button type="button" data-testid="harness-option-deny" data-subtle
                onClick={() => void useHarnessStore.getState().answerPermission(tabId, session.permission!.generation, null)}>
                {t('Deny')}
              </button>
            </div>
          </div>
        )}
        {session?.sessionId && session.questions?.map(question => <HarnessQuestion key={question.requestId} sessionId={session.sessionId!} question={question} />)}
      </div>

      <div className="chat-jump-slot" style={{ visibility: follow.following ? 'hidden' : 'visible' }} aria-hidden={follow.following}>
        <button type="button" data-subtle className="chat-jump-latest" aria-label={t('Jump to latest reply')}
          data-tip={t('Jump to latest reply')} onClick={follow.jumpToLatest}><ArrowDown size={16} /></button>
      </div>

      <ChatComposerShell
        heading={inSidebar ? t('AI chat') : <span data-tip={session?.cwd || cwd || undefined} data-tip-description={t('The harness works in this directory.')}
          style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {harness}{agent ? ` · ${agent.title || agent.name || ''}` : ''}
        </span>}
        hints={<><KeyHint shortcut="Enter" />{t('Send')}</>}
        tray={<><QueuedMessages messages={session?.queuedInputs ?? []} onCancel={id => useHarnessStore.getState().cancelQueuedInput(tabId, id)} />
          {attachments.length > 0 && <div className="chat-context-tray" aria-label={t('Conversation context')}>
            <AttachmentChips atts={attachments} previewId={previewId} onPreview={togglePreview} onRemove={removeAttachment} />
          </div>}
          {matches.length > 0 ? (
          <div {...commandNavigation.props} data-testid="harness-commands" role="listbox" aria-label={t('Slash commands')} className="harness-commands">
            {matches.map((command, index) => (
              <button key={command.name} type="button" data-subtle role="option"
                aria-selected={index === activeCommand} data-active={commandNavigation.keyboardNavigation && index === activeCommand}
                className="harness-command" data-testid={`harness-command-${command.name}`}
                onMouseDown={(event) => event.preventDefault()} onPointerMove={() => { if (commandNavigation.pointerMoved.current) setCommandIndex(index); }}
                onClick={() => pickCommand(command.name)}>
                <span className="harness-command-name">/{command.name}</span>
                <span className="harness-command-copy">
                  <span>{command.description}</span>
                  {command.hint && <small>{command.hint}</small>}
                </span>
              </button>
            ))}
          </div>
        ) : null}</>}
        status={<>
          <IconButton aria-label={t('Add attachment')} data-tip={t('Add attachment')} data-testid="harness-add-attachment"
            onClick={() => void pickFiles()}><Plus size={18} /></IconButton>
          {permissionSelector && <HarnessSelector testId={`harness-selector-${permissionSelector.key}`} label={permissionSelector.label} permission
            value={permissionSelector.value} options={permissionSelector.options} onChange={permissionSelector.apply} />}
          {session?.opening && <span data-testid="harness-opening" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-caption)' }}>
            {t('Connecting…')}
          </span>}
          <span className="chat-footer-space" />
          {modelSelector && <HarnessSelector testId={`harness-selector-${modelSelector.key}`} label={modelSelector.label} model
            value={modelSelector.value} options={modelSelector.options} onChange={modelSelector.apply} />}
          <IconButton aria-label={t('New session')} data-tip={t('New session')} data-testid="harness-new-session"
            disabled={!session?.sessionId || session.pending}
            onClick={() => {
              if (useWorkspaceNavigation.getState().aiPlacement === 'side' && useAiWorkspace.getState().sideSelected === `acp:${tabId}`) createSideAgent(harness, session?.cwd || cwd);
              else {
                const id = useHarnessWorkspace.getState().connect(harness, session?.cwd || cwd, true);
                useAiWorkspace.getState().select(`acp:${id}`);
              }
            }}>
            <Sparkles size={iconSizes.compact} />
          </IconButton>
          {session?.pending && canSend && <IconButton aria-label={t('Queue message')} data-tip={t('Queue message')} onClick={submit}><ArrowUp size={18} /></IconButton>}
          {session?.pending
            ? <IconButton className="chat-send-button" tone="accent" aria-label={t('Stop the harness turn')}
              data-tip={t('Stop the harness turn')} onClick={() => void useHarnessStore.getState().cancel(tabId)}>
              <Square size={15} fill="currentColor" />
            </IconButton>
            : <IconButton className="chat-send-button" tone="accent" aria-label={t('Send')} data-tip={t('Send')}
              data-tip-shortcut="Enter" data-testid="harness-send" disabled={!canSend} onClick={submit}>
              <ArrowUp size={18} />
            </IconButton>}
        </>}
      >
        <TextArea ref={composerRef} data-testid="harness-composer" data-chat-composer={active || undefined} value={text}
          placeholder={t('Describe what you want to do…')} rows={1}
          onChange={(event) => { setText(event.target.value); setCommandDismissed(false); setCommandIndex(0); commandNavigation.setKeyboardNavigation(true); }}
          onKeyDown={(event) => {
            if (matches.length > 0) {
              commandNavigation.setKeyboardNavigation(true);
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setCommandIndex((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length);
                return;
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                setCommandDismissed(true);
                return;
              }
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                pickCommand(matches[activeCommand]!.name);
                return;
              }
            }
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }} onPaste={event => {
            const files = Array.from(event.clipboardData.files);
            if (files.length) { event.preventDefault(); void addBlobs(files); return; }
            if (addPastedText(event.clipboardData.getData('text/plain'))) event.preventDefault();
          }} />
      </ChatComposerShell>
    </div>
  );
}
