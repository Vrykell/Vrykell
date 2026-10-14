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
import { useActiveWorkspace } from '@features/workspace';
import { toExchanges } from '@features/chat/model/exchanges';
import AiBlock from '@features/chat/components/AiBlock';
import { bindHarnessEvents, useHarnessStore } from '../stores/harness';

/**
 * HarnessView — the workspace page of one external harness session.
 *
 * Deliberately built out of the AI panel's own vocabulary: `AiBlock` in conversation presentation
 * gives the same question bubble, answer meta, action row and tool cards, and the composer mirrors
 * the panel's markup (`chat-composer-wrap` / `terminal-composer` / `chat-composer-input` /
 * `chat-input-status`) so the two surfaces read as one product. This page is where the local chat
 * will move next, so the panel's look is the contract, not a coincidence.
 */
export default function HarnessView({ tabId, harness }: { tabId: string; harness: string }) {
  const session = useHarnessStore((state) => state.byTab[tabId]);
  // The session works where the user's terminal is: the workspace already knows that directory, and
  // the backend falls back to its own only when there is no terminal to ask.
  const { activeCwd } = useActiveWorkspace();
  const [text, setText] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bindHarnessEvents(); }, []);
  useEffect(() => () => { void useHarnessStore.getState().close(tabId); }, [tabId]);
  // Opening is idempotent: a tab that already has a session keeps it.
  useEffect(() => {
    if (!session) void useHarnessStore.getState().open(tabId, harness, activeCwd ?? '');
  }, [tabId, harness, session, activeCwd]);

  const agent = session?.agent?.agentInfo;
  const exchanges = toExchanges(session?.messages ?? []);
  const canSend = Boolean(session?.sessionId) && !session?.pending && text.trim().length > 0;

  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
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
        {session?.note && <p data-testid="harness-note" style={{ margin: '6px 4px', color: 'var(--text-muted)', fontSize: 'var(--fs-micro)' }}>
          {session.note}
        </p>}
        {exchanges.map((exchange) => (
          <AiBlock key={exchange.id} exchange={exchange} presentation="conversation" />
        ))}
      </div>

      <div className="chat-composer-wrap">
        <div className="terminal-composer chat-composer">
          <div className="terminal-composer-heading">
            <span data-tip={activeCwd || undefined} data-tip-description={activeCwd ? t('The harness works in this directory.') : undefined}
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {harness}{agent ? ` · ${agent.title || agent.name || ''}` : ''}
            </span>
            <span className="composer-key-hints"><KeyHint shortcut="Enter" />{t('Send')}</span>
          </div>
          <div className="chat-composer-input">
            <Bot size={20} aria-hidden="true" className="chat-composer-lead" />
            <TextArea data-testid="harness-composer" data-chat-composer value={text}
              placeholder={t('Describe what you want to do…')} rows={1}
              onChange={(event) => setText(event.target.value)} onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submit();
                }
              }} />
          </div>
          <div className="chat-input-status">
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
          </div>
        </div>
      </div>
    </div>
  );
}
