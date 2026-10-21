/**
 * HarnessView — the workspace page of one external harness session.
 *
 * The transcript is the same component the AI panel uses (`AiBlock` over `ChatExchange`s), so a
 * harness session reads like every other conversation in the app. Everything that could decide
 * something (approvals, the process, the protocol) happens in Rust; this page sends the user's
 * intent and renders what comes back.
 */
import { useEffect, useRef, useState } from 'react';
import { t } from '@i18n';
import { ArrowDown, ArrowUp, Bot, Plus, Square, iconSizes } from '@ui/icons';
import { IconButton } from '@ui/IconButton';
import ErrorBox from '@ui/ErrorBox';
import { TextArea } from '@ui/TextInput';
import KeyHint from '@ui/KeyHint';
import { formatCompact } from '@features/agent/model/usageStats';
import { useComposerDrafts } from '../stores/composerDrafts';
import { useHarnessWorkspace } from '../stores/harnessWorkspace';
import { useTranscriptFollow } from '../hooks/useTranscriptFollow';
import { OutlineButton } from '@ui/OutlineButton';
import { toExchanges } from '@features/chat/model/exchanges';
import AiBlock from '@features/chat/components/AiBlock';
import ChatComposerShell from './ChatComposerShell';
import HarnessSelector, { type HarnessSelectorOption } from './HarnessSelector';
import { useHarnessStore, type HarnessSession } from '../stores/harness';
import type { AcpConfigGroup, AcpConfigValue } from '@platform/api/acp';

/** One control in the composer's status row. */
interface SessionSelector {
  key: string;
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
      label: option.name,
      value: String(option.currentValue),
      options,
      apply: (value) => void store.setConfigOption(tabId, option.id, value),
    });
  }
  const hasMode = configs.some((option) => option.category === 'mode');
  if (!hasMode && session.modes) {
    selectors.push({
      key: 'mode',
      label: t('Mode'),
      value: session.modes.currentModeId,
      options: session.modes.availableModes.map((mode) => ({
        value: mode.id, label: mode.name, description: mode.description,
      })),
      apply: (value) => void store.setMode(tabId, value),
    });
  }
  const hasModel = configs.some((option) => option.category === 'model');
  if (!hasModel && session.models) {
    selectors.push({
      key: 'model',
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
export default function HarnessView({ tabId, harness, cwd, fresh = false, active = true }: { tabId: string; harness: string; cwd?: string; fresh?: boolean; active?: boolean }) {
  const session = useHarnessStore((state) => state.byTab[tabId]);
  const text = useComposerDrafts(state => state.byTab[tabId]?.text ?? '');
  const setText = (value: string) => useComposerDrafts.getState().setText(tabId, value);
  const follow = useTranscriptFollow(tabId, session?.messages, active);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  /** Escape hides the command list for the current text without touching what was typed. */
  const [commandDismissed, setCommandDismissed] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);
  /** The store refuses a second open for a tab that is already opening, so a re-rendered effect or a
   *  double click can only ever start one agent process. */
  useEffect(() => {
    if (session) return;
    void useHarnessStore.getState().open(tabId, harness, cwd ?? '', fresh);
  }, [tabId, harness, session, cwd, fresh]);

  const agent = session?.agent?.agentInfo;
  const exchanges = toExchanges(session?.messages ?? []);
  const canSend = Boolean(session?.sessionId) && !session?.pending && text.trim().length > 0;
  const selectors = session ? sessionSelectors(session, tabId) : [];
  const hints = authHints(session?.agent ?? null);
  const plan = session?.plan ?? [];

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

  const submit = () => {
    if (!canSend) return;
    const value = text;
    follow.jumpToLatest();
    setText('');
    void useHarnessStore.getState().prompt(tabId, value);
  };

  return (
    <div data-testid="harness-page" className="ai-chat-panel" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="chat-conversation-context" data-testid="harness-directory" data-tip={session?.cwd || cwd || undefined}>
        {session?.cwd || cwd || t('Default project folder')}
      </div>
      <div ref={follow.scrollRef} className="scroll-region chat-transcript" onScroll={follow.onScroll}
        onWheel={follow.onWheel} onTouchMove={follow.onTouchMove}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 14px 4px' }}>
        {!session && <p style={{ margin: '10px 4px', color: 'var(--text-muted)', fontSize: 'var(--fs-caption)' }}>
          {t('Opening the harness session…')}
        </p>}
        {session?.error && <ErrorBox title={t('Connection failed')} details={session.error}
          actions={!session.sessionId && <OutlineButton onClick={() => void useHarnessStore.getState().open(tabId, harness, cwd ?? '', fresh)}>{t('Retry')}</OutlineButton>} />}
        {/* A failed turn is often just a missing login: the agent said how to sign in at handshake. */}
        {session?.error && hints.length > 0 && (
          <p data-testid="harness-auth-hint" style={{ margin: '2px 4px 8px', color: 'var(--text-muted)', fontSize: 'var(--fs-caption)' }}>
            {t('Log in to this agent first:')} {hints.join(' · ')}
          </p>
        )}
        {session?.note && <p data-testid="harness-note" style={{ margin: '6px 4px', color: 'var(--text-muted)', fontSize: 'var(--fs-micro)' }}>
          {session.note}
        </p>}
        {exchanges.map((exchange) => (
          <AiBlock key={exchange.id} exchange={exchange} presentation="conversation" />
        ))}
        {/* The plan the agent publishes while it works, in the order it sent it. */}
        {plan.length > 0 && (
          <div data-testid="harness-plan" style={{
            margin: '10px 4px', padding: '8px 10px', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-inner)', background: 'var(--surface)',
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
      </div>

      <div className="chat-jump-slot" style={{ visibility: follow.following ? 'hidden' : 'visible' }} aria-hidden={follow.following}>
        <button type="button" data-subtle className="chat-jump-latest" aria-label={t('Jump to latest reply')}
          data-tip={t('Jump to latest reply')} onClick={follow.jumpToLatest}><ArrowDown size={16} /></button>
      </div>

      <ChatComposerShell
        heading={<span data-tip={session?.cwd || cwd || undefined} data-tip-description={t('The harness works in this directory.')}
          style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {harness}{agent ? ` · ${agent.title || agent.name || ''}` : ''}
        </span>}
        hints={<><KeyHint shortcut="Enter" />{t('Send')}</>}
        tray={matches.length > 0 ? (
          <div data-testid="harness-commands" role="listbox" aria-label={t('Slash commands')} className="harness-commands">
            {matches.map((command, index) => (
              <button key={command.name} type="button" data-subtle role="option"
                aria-selected={index === activeCommand} data-active={index === activeCommand}
                className="harness-command" data-testid={`harness-command-${command.name}`}
                onMouseDown={(event) => event.preventDefault()} onPointerMove={() => setCommandIndex(index)}
                onClick={() => pickCommand(command.name)}>
                <span className="harness-command-name">/{command.name}</span>
                <span className="harness-command-copy">
                  <span>{command.description}</span>
                  {command.hint && <small>{command.hint}</small>}
                </span>
              </button>
            ))}
          </div>
        ) : undefined}
        status={<>
          <IconButton compact aria-label={t('New session')} data-tip={t('New session')} data-testid="harness-new-session"
            disabled={!session?.sessionId || session.pending}
            onClick={() => useHarnessWorkspace.getState().connect(harness, session?.cwd || cwd, true)}>
            <Plus size={iconSizes.compact} />
          </IconButton>
          {selectors.map((selector) => (
            <HarnessSelector key={selector.key} testId={`harness-selector-${selector.key}`} label={selector.label}
              value={selector.value} options={selector.options} onChange={selector.apply} />
          ))}
          {session?.context && (session.context.used > 0 || session.context.size > 0) && (
            <span data-testid="harness-context" className="harness-context" data-tip={t('Context window in use')}>
              {contextLabel(session.context)}
            </span>
          )}
          {session?.opening && <span data-testid="harness-opening" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-caption)' }}>
            {t('Connecting…')}
          </span>}
          <span className="chat-footer-space" />
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
        <Bot size={20} aria-hidden="true" className="chat-composer-lead" />
        <TextArea ref={composerRef} data-testid="harness-composer" data-chat-composer={active || undefined} value={text}
          placeholder={t('Describe what you want to do…')} rows={1}
          onChange={(event) => { setText(event.target.value); setCommandDismissed(false); setCommandIndex(0); }}
          onKeyDown={(event) => {
            if (matches.length > 0) {
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
          }} />
      </ChatComposerShell>
    </div>
  );
}
