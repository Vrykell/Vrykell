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
import { iconSizes, Bot } from '@ui/icons';
import { toExchanges } from '@features/chat/model/exchanges';
import AiBlock from '@features/chat/components/AiBlock';
import { bindHarnessEvents, useHarnessStore } from '../stores/harness';

export default function HarnessView({ tabId, harness }: { tabId: string; harness: string }) {
  const session = useHarnessStore((state) => state.byTab[tabId]);
  const [text, setText] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bindHarnessEvents(); }, []);
  useEffect(() => () => { void useHarnessStore.getState().close(tabId); }, [tabId]);
  // Opening is idempotent: a tab that already has a session keeps it.
  useEffect(() => {
    if (!session) void useHarnessStore.getState().open(tabId, harness, '');
  }, [tabId, harness, session]);

  // A session without a background is empty: nothing to connect to.
  const agent = session?.agent?.agentInfo;
  const exchanges = toExchanges(session?.messages ?? []);

  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [exchanges.length, session?.pending]);

  const send = () => {
    const value = text.trim();
    if (!value || !session?.sessionId || session.pending) return;
    setText('');
    void useHarnessStore.getState().prompt(tabId, value);
  };

  return (
    <div data-testid="harness-page" className="scroll-region" style={{
      flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--canvas)',
      fontFamily: 'var(--font-ui)',
    }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderBottom: '1px solid var(--border)' }}>
        <Bot size={iconSizes.row} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
        <strong style={{ color: 'var(--text-primary)', fontSize: 'var(--fs-label)', fontWeight: 'var(--fw-semibold)' }}>
          {harness}
        </strong>
        {agent && <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-caption)' }}>
          {agent.title || agent.name || ''}{agent.version ? ` ${agent.version}` : ''}
        </span>}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {session?.opening && <span data-testid="harness-opening" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-caption)' }}>
            {t('Connecting…')}
          </span>}
          {session?.pending && <button type="button" data-subtle data-testid="harness-stop"
            style={{ padding: '4px 10px' }} onClick={() => void useHarnessStore.getState().cancel(tabId)}>
            {t('Stop the harness turn')}
          </button>}
        </span>
      </header>

      <div ref={bodyRef} className="scroll-region" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 18px 18px' }}>
        {!session && <p data-testid="harness-empty" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-caption)' }}>
          {t('Opening the harness session…')}
        </p>}
        {session?.error && <p data-testid="harness-error" role="status" style={{ color: 'var(--error)', fontSize: 'var(--fs-caption)' }}>
          {session.error}
        </p>}
        {session?.note && <p data-testid="harness-note" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-caption)' }}>
          {session.note}
        </p>}
        {exchanges.map((exchange) => (
          <AiBlock key={exchange.id} exchange={exchange} presentation="block" dividerBefore={false} />
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, padding: '10px 18px 14px', borderTop: '1px solid var(--border)' }}>
        <textarea
          data-testid="harness-composer" data-chat-composer
          value={text}
          placeholder={t('Send a prompt to this harness…')}
          aria-label={t('Harness prompt')}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          rows={1}
          style={{
            flex: 1, minHeight: 34, maxHeight: 160, resize: 'none', padding: '7px 10px',
            border: '1px solid var(--border)', borderRadius: 'var(--radius-inner)',
            background: 'var(--field-bg)', color: 'var(--text-primary)', font: 'inherit',
          }}
        />
        <button type="button" data-subtle data-testid="harness-send" disabled={!session?.sessionId || session.pending || !text.trim()}
          onClick={send} style={{ padding: '7px 12px', borderRadius: 'var(--radius-inner)' }}>
          {t('Send to the harness')}
        </button>
      </div>
    </div>
  );
}
