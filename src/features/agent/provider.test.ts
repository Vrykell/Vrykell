/**
 * provider — 思考强度映射与模型工厂测试。
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./llmFetch', () => ({ createProxyFetch: () => vi.fn() }));

import { createChatModel, deepThinkProviderOptions } from '@/features/agent/provider';

describe('deepThinkProviderOptions', () => {
  it('openai-compatible → reasoning_effort 按档位', () => {
    expect(deepThinkProviderOptions('openai-compatible', 'low')).toEqual({
      vrykell: { reasoning_effort: 'low' },
    });
    expect(deepThinkProviderOptions('openai-compatible', 'medium')).toEqual({
      vrykell: { reasoning_effort: 'medium' },
    });
    expect(deepThinkProviderOptions('openai-compatible')).toEqual({
      vrykell: { reasoning_effort: 'high' },
    });
  });
  it('anthropic → thinking budget 按档位递增', () => {
    const low = deepThinkProviderOptions('anthropic', 'low');
    const high = deepThinkProviderOptions('anthropic', 'high');
    expect(
      (low.anthropic as { thinking: { budgetTokens: number } }).thinking.budgetTokens,
    ).toBeLessThan(
      (high.anthropic as { thinking: { budgetTokens: number } }).thinking.budgetTokens,
    );
  });
  it('gemini → thinkingBudget 按档位递增', () => {
    const low = deepThinkProviderOptions('gemini', 'low');
    const high = deepThinkProviderOptions('gemini', 'high');
    expect(
      (low.google as { thinkingConfig: { thinkingBudget: number } }).thinkingConfig.thinkingBudget,
    ).toBeLessThan(
      (high.google as { thinkingConfig: { thinkingBudget: number } }).thinkingConfig.thinkingBudget,
    );
  });
  it('createChatModel 为三种 provider 返回模型', () => {
    for (const provider of ['openai-compatible', 'anthropic', 'gemini'] as const) {
      const m = createChatModel({ provider, baseUrl: 'https://x', model: 'm' });
      expect(m).toBeTruthy();
    }
  });
});
