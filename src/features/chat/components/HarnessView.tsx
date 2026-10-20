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
import { ArrowUp, Bot, Square } from '@ui/icons';
import { IconButton } from '@ui/IconButton';
import ErrorBox from '@ui/ErrorBox';
import { TextArea } from '@ui/TextInput';
import KeyHint from '@ui/KeyHint';
import { formatCompact } from '@features/agent/model/usageStats';
import { useActiveWorkspace } from '@features/workspace';
import { toExchanges } from '@features/chat/model/exchanges';
import AiBlock from '@features/chat/components/AiBlock';
import ChatComposerShell from './ChatComposerShell';
import HarnessSelector, { type HarnessSelectorOption } from './HarnessSelector';
import { bindHarnessEvents, useHarnessStore, type HarnessSession } from '../stores/harness';
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
 * HarnessView — the workspace page of one external harness session.
 *
 * Deliberately built out of the AI panel's own vocabulary: `AiBlock` in conversation presentation
 * gives the same question bubble, answer meta, action row and tool cards, and the composer mirrors
 * the panel's markup (`chat-composer-wrap` / `terminal-composer` / `chat-composer-input` /
 * `chat-input-status`) so the two surfaces read as one product. This page is where the local chat
 * will move next, so the panel's look is the contract, not a coincidence.
 */
export default function HarnessView({ tabId, harness, cwd }: { tabId: string; harness: string; cwd?: string }) {
  const session = useHarnessStore((state) => state.byTab[tabId]);
  // The session works where the user's terminal is: the workspace already knows that directory, and
  // the backend falls back to its own only when there is no terminal to ask.
  const { activeCwd } = useActiveWorkspace();
  const [text, setText] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  /** Opening must happen once at a time per tab: React's double-invoked effects spawned two sessions.
   *  The guard is released when the attempt settles, so a remount (which an unmount cleanup closed)
   *  can open again. */
  const opening = useRef<string | null>(null);

  useEffect(() => { bindHarnessEvents(); }, []);
  useEffect(() => {
    if (session || opening.current === tabId) return;
    opening.current = tabId;
    void useHarnessStore.getState().open(tabId, harness, cwd ?? activeCwd ?? '').finally(() => {
      if (opening.current === tabId) opening.current = null;
    });
  }, [tabId, harness, session, activeCwd, cwd]);

  const agent = session?.agent?.agentInfo;
  const exchanges = toExchanges(session?.messages ?? []);
  const canSend = Boolean(session?.sessionId) && !session?.pending && text.trim().length > 0;
  const selectors = session ? sessionSelectors(session, tabId) : [];
  const hints = authHints(session?.agent ?? null);
  const plan = session?.plan ?? [];

  useEffect(() => {
    const body = bodyRef.current;
    // Only follow while the view is already at the bottom: a scrollbar dragged upwards stays put.
    if (body && body.scrollHeight - body.scrollTop - body.clientHeight <= 24) body.scrollTop = body.scrollHeight;
  }, [exchanges.length, session?.pending]);

  const submit = () => {
    if (!canSend) return;
    const value = text;
    setText('');
    void useHarnessStore.getState().prompt(tabId, value);
  };

  return (
    <div data-testid="harness-page" className="ai-chat-panel" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div ref={bodyRef} className="scroll-region" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 14px 4px' }}>
        {!session && <p style={{ margin: '10px 4px', color: 'var(--text-muted)', fontSize: 'var(--fs-caption)' }}>
          {t('Opening the harness session…')}
        </p>}
        {session?.error && <ErrorBox compact>{session.error}</ErrorBox>}
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

      <ChatComposerShell
        heading={<span data-tip={activeCwd || undefined} data-tip-description={activeCwd ? t('The harness works in this directory.') : undefined}
          style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {harness}{agent ? ` · ${agent.title || agent.name || ''}` : ''}
        </span>}
        hints={<><KeyHint shortcut="Enter" />{t('Send')}</>}
        status={<>
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
        <TextArea data-testid="harness-composer" data-chat-composer value={text}
          placeholder={t('Describe what you want to do…')} rows={1}
          onChange={(event) => setText(event.target.value)} onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }} />
      </ChatComposerShell>
    </div>
  );
}
