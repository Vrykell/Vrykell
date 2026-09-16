import { describe, it, expect } from 'vitest';
import { toExchanges, mergeFlow } from '@features/chat/model/exchanges';
import type { ChatMessage } from '@/store/chat';
import type { TermBlock } from '@features/terminal/services/pipeline/termBlock';

const msg = (id: string, role: 'user' | 'assistant', createdAt: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id, role, content: `${role}-${id}`, createdAt, ...extra,
});

const block = (id: string, startedAt: number): TermBlock => ({
  id,
  command: `cmd-${id}`,
  exitCode: 0,
  startedAt,
  endedAt: startedAt + 100,
  status: 'done',
  wasLongRunning: false,
  outputHtml: '',
  outputText: '',
  outputRaw: '',
  linesTruncated: 0,
});

describe('toExchanges', () => {
  it('user/assistant 配对一个交换', () => {
    const ex = toExchanges([msg('q1', 'user', 1), msg('a1', 'assistant', 2)]);
    expect(ex).toHaveLength(1);
    expect(ex[0]!.question!.id).toBe('q1');
    expect(ex[0]!.answer!.id).toBe('a1');
    expect(ex[0]!.createdAt).toBe(1);
  });

  it('连续多个问答各自成交换', () => {
    const ex = toExchanges([
      msg('q1', 'user', 1), msg('a1', 'assistant', 2),
      msg('q2', 'user', 3), msg('a2', 'assistant', 4),
    ]);
    expect(ex.map((e) => e.id)).toEqual(['q1', 'q2']);
  });

  it('未配对的助手消息成为独立交换（旧数据兜底）', () => {
    const ex = toExchanges([msg('a1', 'assistant', 1)]);
    expect(ex).toHaveLength(1);
    expect(ex[0]!.question).toBeUndefined();
    expect(ex[0]!.answer!.id).toBe('a1');
  });

  it('流式中的交换：有问无答', () => {
    const ex = toExchanges([msg('q1', 'user', 1)]);
    expect(ex[0]!.answer).toBeUndefined();
  });
});

describe('mergeFlow', () => {
  it('块与 AI 交换按时间戳交错归并', () => {
    const exchanges = toExchanges([msg('q1', 'user', 150, { paneId: 'p1' }), msg('a1', 'assistant', 160)]);
    const flow = mergeFlow([block('b1', 100), block('b2', 200)], exchanges);
    expect(flow.map((f) => (f.type === 'block' ? f.block.id : f.exchange.id))).toEqual(['b1', 'q1', 'b2']);
    expect(flow[1]).toMatchObject({ type: 'ai', ts: 150 });
  });

  it('空输入返回空', () => {
    expect(mergeFlow([], [])).toEqual([]);
  });

  it('只有 AI 交换时原样返回', () => {
    const exchanges = toExchanges([msg('q1', 'user', 1)]);
    const flow = mergeFlow([], exchanges);
    expect(flow).toHaveLength(1);
    expect(flow[0]!.type).toBe('ai');
  });
});
