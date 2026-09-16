/**
 * exchanges — 把扁平的 ChatMessage 流折叠为「问答交换」，并与命令块按时间归并。
 *
 * 内联 AI 块与命令块共享同一条时间线：问 = 一次"输入"，答 = 它的"输出"。
 * 归并是纯渲染层操作，不改 block store，也不改终端管线。
 */

import type { ChatMessage } from '@entities/chat';
import type { TermBlock } from '@features/terminal/pipeline/termBlock';

/** 一次问答交换：用户问题 + 可选的 AI 回答（流式中回答可能为空） */
export interface ChatExchange {
  /** 取问题的消息 id（无问题则取回答 id） */
  id: string;
  paneId?: string;
  createdAt: number;
  question?: ChatMessage;
  answer?: ChatMessage;
}

/** 扁平消息 → 问答交换序列。未配对的消息各自成为独立交换（旧数据/异常兜底）。 */
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

/** 命令块与 AI 交换按时间戳归并排序（稳定：同时间块在前；无 startedAt 的块视为最早）。
 *
 *  agent 发起的命令块不进入本流程 —— 调用方（TerminalBlockList）预先过滤，
 *  它们由 AiBlock 内嵌渲染在 run_command 节点之下，不再是独立时间线条目。 */
export function mergeFlow(blocks: TermBlock[], exchanges: ChatExchange[]): FlowItem[] {
  const items: FlowItem[] = [
    ...blocks.map((block) => ({ type: 'block' as const, block, ts: block.startedAt ?? 0 })),
    ...exchanges.map((exchange) => ({ type: 'ai' as const, exchange, ts: exchange.createdAt })),
  ];
  return items.sort((a, b) => a.ts - b.ts);
}
