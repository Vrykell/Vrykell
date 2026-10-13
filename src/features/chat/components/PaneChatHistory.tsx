import { useMemo } from 'react';
import { usePaneMessages } from '../stores/chat';
import { toExchanges } from '../model/exchanges';
import AiBlock from './AiBlock';

/** Keep conversation history visible while the terminal reconnects in classic mode. */
export default function PaneChatHistory({ paneId }: { paneId: string }) {
  const messages = usePaneMessages(paneId);
  const exchanges = useMemo(() => toExchanges(messages), [messages]);
  if (!exchanges.length) return null;
  return <div className="scroll-region" data-testid="terminal-chat-history"
    style={{ maxHeight: '50%', minHeight: 0, flexShrink: 1, overflowY: 'auto', padding: '4px 0 8px' }}>
    {exchanges.map((exchange, index) => <AiBlock key={exchange.id} exchange={exchange} dividerBefore={index > 0}
      style={{ paddingLeft: 16, paddingRight: 16 }} />)}
  </div>;
}
