/**
 * exchanges — folds the flat ChatMessage stream into question/answer exchanges and
 * merges them with command blocks by time.
 *
 * Inline AI blocks and command blocks share one timeline: a question is an "input",
 * its answer is the "output". Merging is a pure render-layer operation; it touches
 * neither the block store nor the terminal pipeline.
 */

import type { ChatMessage } from '@features/chat';
import type { TermBlock } from '@features/terminal/services/pipeline/termBlock';

/** One question/answer exchange: a user question plus an optional AI answer (empty while streaming) */
export interface ChatExchange {
  /** Question message id, or the answer id when there is no question */
  id: string;
  paneId?: string;
  createdAt: number;
  question?: ChatMessage;
  answer?: ChatMessage;
}

/** Flat messages → exchange sequence. Unpaired messages become standalone exchanges (legacy data / defensive fallback). */
export function toExchanges(messages: ChatMessage[]): ChatExchange[] {
  const out: ChatExchange[] = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (m.role === 'user') {
      out.push({ id: m.id, paneId: m.paneId, createdAt: m.createdAt, question: m });
    } else if (last && !last.answer) {
      last.answer = m;
    } else {
      out.push({ id: m.id, paneId: m.paneId, createdAt: m.createdAt, answer: m });
    }
  }
  return out;
}

export type FlowItem =
  | { type: 'block'; block: TermBlock; ts: number }
  | { type: 'ai'; exchange: ChatExchange; ts: number };

/** Merges command blocks and AI exchanges by timestamp (stable: blocks win ties; blocks
 *  without startedAt count as earliest).
 *
 *  Agent-issued command blocks never enter this flow — the caller filters them out
 *  beforehand, because they render nested under run_command nodes inside AiBlock
 *  rather than as standalone timeline entries. */
export function mergeFlow(blocks: TermBlock[], exchanges: ChatExchange[]): FlowItem[] {
  const items: FlowItem[] = [
    ...blocks.map((block) => ({ type: 'block' as const, block, ts: block.startedAt ?? 0 })),
    ...exchanges.map((exchange) => ({ type: 'ai' as const, exchange, ts: exchange.createdAt })),
  ];
  return items.sort((a, b) => a.ts - b.ts);
}
