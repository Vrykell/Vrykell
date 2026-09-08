/**
 * context（code-agent 式上下文管理）测试：token 估算、窗口裁剪、摘要压缩与增量缓存。
 * 模块级 mock 'ai'（generateText），不用 beforeEach（本仓库 vitest 4 陷阱），
 * 各用例开头调 reset()。
 */

import type { LanguageModel, ModelMessage } from 'ai';
import { describe, expect, it, vi } from 'vitest';

const { mockGenerate } = vi.hoisted(() => ({ mockGenerate: vi.fn() }));
vi.mock('ai', () => ({ generateText: mockGenerate }));

import { estimateTokens, planContext, type SizedMessage } from '@/features/agent/context';

const model = {} as LanguageModel;

function mk(role: 'user' | 'assistant', text: string, tokens: number): SizedMessage {
  return { msg: { role, content: text } as ModelMessage, tokens };
}

function reset() {
  mockGenerate.mockReset();
}

describe('estimateTokens', () => {
  it('CJK 按 1 token/字，ASCII 按 4 字符/token', () => {
    expect(estimateTokens('你好')).toBe(2);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('你好ab')).toBe(3); // 2 + 2×0.25 = 2.5 → 3
    expect(estimateTokens('')).toBe(0);
  });
});

describe('planContext：off / window', () => {
  it('off 返回全部消息，不裁剪', async () => {
    reset();
    const r = await planContext({
      sized: [mk('user', 'a', 5), mk('assistant', 'b', 5), mk('user', 'c', 5)],
      strategy: 'off',
      maxTokens: 1,
      summaryTokens: 100,
      model,
    });
    expect(r.system).toBeUndefined();
    expect(r.messages).toHaveLength(3);
  });

  it('window 超预算：保留能放下的最近消息', async () => {
    reset();
    const r = await planContext({
      sized: [mk('user', 'a', 5), mk('assistant', 'b', 5), mk('user', 'c', 5)],
      strategy: 'window',
      maxTokens: 12,
      summaryTokens: 100,
      model,
    });
    expect(r.system).toBeUndefined();
    expect(r.messages).toHaveLength(2); // 5+5 放得下，三条放不下
  });

  it('最新一条即使超预算也保底保留', async () => {
    reset();
    const r = await planContext({
      sized: [mk('user', 'a', 5), mk('user', 'current', 100)],
      strategy: 'window',
      maxTokens: 10,
      summaryTokens: 100,
      model,
    });
    expect(r.messages).toHaveLength(1);
    const only = r.messages[0] as { content: string };
    expect(only.content).toBe('current');
  });
});

describe('planContext：compact 摘要压缩', () => {
  it('超预算生成摘要并作为 system 前置', async () => {
    reset();
    mockGenerate.mockResolvedValue({ text: '摘要内容' });
    const r = await planContext({
      sized: [mk('user', 'a', 5), mk('assistant', 'b', 5), mk('user', 'c', 5)],
      strategy: 'compact',
      maxTokens: 12,
      summaryTokens: 100,
      model,
      tabId: 't1',
    });
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(r.system).toBe('摘要内容');
    expect(r.messages).toHaveLength(2);
  });

  it('增量缓存：新增溢出只摘要增量，不重复折叠旧内容', async () => {
    reset();
    mockGenerate.mockResolvedValueOnce({ text: '摘要1' });
    const base = [
      mk('user', 'a', 5),
      mk('assistant', 'b', 5),
      mk('user', 'c', 5),
      mk('assistant', 'd', 5),
      mk('user', 'e', 5),
    ];
    const r1 = await planContext({
      sized: base,
      strategy: 'compact',
      maxTokens: 12,
      summaryTokens: 100,
      model,
      tabId: 't-inc',
    });
    expect(r1.system).toBe('摘要1');
    expect(mockGenerate).toHaveBeenCalledTimes(1);

    mockGenerate.mockResolvedValueOnce({ text: '摘要2' });
    const grown = [...base, mk('user', 'f', 5)];
    const r2 = await planContext({
      sized: grown,
      strategy: 'compact',
      maxTokens: 12,
      summaryTokens: 100,
      model,
      tabId: 't-inc',
    });
    expect(r2.system).toBe('摘要2');
    expect(mockGenerate).toHaveBeenCalledTimes(2); // 只摘要新增的 1 条
  });

  it('摘要失败降级为窗口裁剪（不抛错）', async () => {
    reset();
    mockGenerate.mockRejectedValue(new Error('boom'));
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await planContext({
      sized: [mk('user', 'a', 5), mk('assistant', 'b', 5), mk('user', 'c', 5)],
      strategy: 'compact',
      maxTokens: 12,
      summaryTokens: 100,
      model,
      tabId: 't-fail',
    });
    spy.mockRestore();
    expect(r.system).toBeUndefined();
    expect(r.messages).toHaveLength(2);
  });
});
