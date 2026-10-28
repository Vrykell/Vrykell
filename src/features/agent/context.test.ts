/**
 * context tests (code-agent style context management): token estimation, window trimming, summary
 * compaction and incremental caching. The 'ai' module (generateText) is mocked at module level,
 * no beforeEach is used (a vitest 4 trap in this repository), and each case calls reset() at the start.
 */
import { describe, it, expect, vi } from 'vitest';
import type { LanguageModel, ModelMessage } from 'ai';

const { mockGenerate } = vi.hoisted(() => ({ mockGenerate: vi.fn() }));
vi.mock('ai', () => ({ generateText: mockGenerate }));

import { estimateTokens, messageTokens, planContext, IMAGE_TOKEN_ESTIMATE, type SizedMessage } from '@features/agent/model/context';

const model = {} as LanguageModel;

function mk(role: 'user' | 'assistant', text: string, tokens: number): SizedMessage {
  return { msg: { role, content: text } as ModelMessage, tokens };
}

function reset() {
  mockGenerate.mockReset();
}

describe('estimateTokens', () => {
  it('counts image overhead without counting encoded image bytes as text', () => {
    expect(messageTokens({ role: 'user', content: [{ type: 'image', image: 'data:image/png;base64,' + 'x'.repeat(100_000) }] })).toBe(IMAGE_TOKEN_ESTIMATE + 16);
  });
  it('CJK counts as 1 token per character, ASCII as 4 characters per token', () => {
    expect(estimateTokens('你好')).toBe(2);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('你好ab')).toBe(3); // 2 + 2×0.25 = 2.5 → 3
    expect(estimateTokens('')).toBe(0);
  });
});

describe('planContext: off / window', () => {
  it('reserves instruction and tool-schema space and never keeps an orphaned result', async () => {
    reset();
    const grouped: SizedMessage[] = [mk('user', 'earlier', 5),
      { ...mk('assistant', 'call', 6), group: 'tools' },
      { msg: { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'one', toolName: 'read', output: { type: 'text', value: 'evidence' } }] }, tokens: 6, group: 'tools' },
      mk('user', 'current', 5)];
    const plan = await planContext({ sized: grouped, strategy: 'window', maxTokens: 20, reservedTokens: 5, summaryTokens: 0, model });
    expect(plan.messages).toEqual([{ role: 'user', content: 'current' }]);
  });
  it('off returns every message without trimming', async () => {
    reset();
    const r = await planContext({
      sized: [mk('user', 'a', 5), mk('assistant', 'b', 5), mk('user', 'c', 5)],
      strategy: 'off', maxTokens: 1, summaryTokens: 100, model,
    });
    expect(r.system).toBeUndefined();
    expect(r.messages).toHaveLength(3);
  });

  it('window over budget: keeps the most recent messages that fit', async () => {
    reset();
    const r = await planContext({
      sized: [mk('user', 'a', 5), mk('assistant', 'b', 5), mk('user', 'c', 5)],
      strategy: 'window', maxTokens: 12, summaryTokens: 100, model,
    });
    expect(r.system).toBeUndefined();
    expect(r.messages).toHaveLength(2); // 5+5 fits, all three do not
  });

  it('the newest message is always kept even when it exceeds the budget', async () => {
    reset();
    const r = await planContext({
      sized: [mk('user', 'a', 5), mk('user', 'current', 100)],
      strategy: 'window', maxTokens: 10, summaryTokens: 100, model,
    });
    expect(r.messages).toHaveLength(1);
    const only = r.messages[0] as { content: string };
    expect(only.content).toBe('current');
  });
});

describe('planContext: compact summary', () => {
  it('merges a previous step summary instead of losing it during later loop compaction', async () => {
    reset(); mockGenerate.mockResolvedValue({ text: 'Merged evidence' });
    const result = await planContext({ sized: [mk('assistant', 'new tool evidence', 1000), mk('user', 'current', 500)],
      strategy: 'compact', maxTokens: 1200, summaryTokens: 100, previousSummary: 'Earlier execution evidence', model });
    expect(mockGenerate.mock.calls[0]?.[0].prompt).toContain('Earlier execution evidence');
    expect(mockGenerate.mock.calls[0]?.[0].prompt).toContain('new tool evidence');
    expect(result.system).toBe('Merged evidence');
  });
  it('over budget generates a summary and prepends it as the system message', async () => {
    reset();
    mockGenerate.mockResolvedValue({ text: '摘要' });
    const r = await planContext({
      sized: [mk('user', 'a', 500), mk('assistant', 'b', 500), mk('user', 'c', 500)],
      strategy: 'compact', maxTokens: 1200, summaryTokens: 100, model, tabId: 't1',
    });
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(r.system).toBe('摘要');
    expect(r.messages).toHaveLength(2);
  });

  it('incremental cache: newly added overflow summarizes only the delta without folding old content again', async () => {
    reset();
    mockGenerate.mockResolvedValueOnce({ text: '摘要1' });
    const base = [mk('user', 'a', 500), mk('assistant', 'b', 500), mk('user', 'c', 500), mk('assistant', 'd', 500), mk('user', 'e', 500)];
    const r1 = await planContext({
      sized: base, strategy: 'compact', maxTokens: 1200, summaryTokens: 100, model, tabId: 't-inc',
    });
    expect(r1.system).toBe('摘要1');
    expect(mockGenerate).toHaveBeenCalledTimes(1);

    mockGenerate.mockResolvedValueOnce({ text: '摘要2' });
    const grown = [...base, mk('user', 'f', 500)];
    const r2 = await planContext({
      sized: grown, strategy: 'compact', maxTokens: 1200, summaryTokens: 100, model, tabId: 't-inc',
    });
    expect(r2.system).toBe('摘要2');
    expect(mockGenerate).toHaveBeenCalledTimes(2); // Only the 1 newly added message is summarized
  });

  it('summary failure degrades to window trimming (without throwing)', async () => {
    reset();
    mockGenerate.mockRejectedValue(new Error('boom'));
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await planContext({
      sized: [mk('user', 'a', 500), mk('assistant', 'b', 500), mk('user', 'c', 500)],
      strategy: 'compact', maxTokens: 1200, summaryTokens: 100, model, tabId: 't-fail',
    });
    spy.mockRestore();
    expect(r.system).toBeUndefined();
    expect(r.messages).toHaveLength(2);
  });
});
