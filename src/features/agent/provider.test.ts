/**
 * provider — 思考强度映射与模型工厂测试。
 */
import { describe, it, expect, vi } from 'vitest';
const proxy = vi.hoisted(() => vi.fn<typeof fetch>());
vi.mock('@features/agent/services/llmFetch', () => ({ createProxyFetch: () => proxy }));
import { deepThinkProviderOptions, createChatModel, baseUrlForProvider, effectiveEndpoint } from '@features/agent/services/provider';

describe('deepThinkProviderOptions', () => {
  it('openai-compatible → reasoning_effort 按档位', () => {
    expect(deepThinkProviderOptions('openai-compatible', 'low')).toEqual({ vrykell: { reasoning_effort: 'low' } });
    expect(deepThinkProviderOptions('openai-compatible', 'medium')).toEqual({ vrykell: { reasoning_effort: 'medium' } });
    expect(deepThinkProviderOptions('openai-compatible')).toEqual({ vrykell: { reasoning_effort: 'high' } });
  });
  it('anthropic → thinking budget 按档位递增', () => {
    const low = deepThinkProviderOptions('anthropic', 'low');
    const high = deepThinkProviderOptions('anthropic', 'high');
    expect((low.anthropic as { thinking: { budgetTokens: number } }).thinking.budgetTokens).toBeLessThan(
      (high.anthropic as { thinking: { budgetTokens: number } }).thinking.budgetTokens,
    );
  });
  it('anthropic 兼容端点显式关闭 thinking，官方端点才按开关发送', () => {
    expect(deepThinkProviderOptions('anthropic', 'high', 'https://api.deepseek.com/anthropic')).toEqual({
      anthropic: { thinking: { type: 'disabled' } },
    });
    expect(deepThinkProviderOptions('anthropic', 'high', 'https://api.deepseek.com/anthropic', false)).toEqual({
      anthropic: { thinking: { type: 'disabled' } },
    });
    expect(deepThinkProviderOptions('anthropic', 'high', 'https://api.anthropic.com')).toEqual({
      anthropic: { thinking: { type: 'enabled', budgetTokens: 16000 } },
    });
    expect(deepThinkProviderOptions('anthropic', 'high', 'https://api.anthropic.com', false)).toEqual({});
  });
  it('gemini → thinkingBudget 按档位递增', () => {
    const low = deepThinkProviderOptions('gemini', 'low');
    const high = deepThinkProviderOptions('gemini', 'high');
    expect((low.google as { thinkingConfig: { thinkingBudget: number } }).thinkingConfig.thinkingBudget).toBeLessThan(
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


describe('configured provider endpoints', () => {
  it('updates official defaults when switching providers and preserves custom gateways', () => {
    expect(baseUrlForProvider('https://api.openai.com/v1/', 'anthropic')).toBe('https://api.anthropic.com/v1');
    expect(baseUrlForProvider('', 'gemini')).toBe('https://generativelanguage.googleapis.com/v1beta');
    expect(baseUrlForProvider('https://gateway.example/v1', 'anthropic')).toBe('https://gateway.example/v1');
  });
  it('spells out the endpoint a request really reaches', () => {
    expect(effectiveEndpoint('anthropic', 'https://api.anthropic.com/v1/')).toBe('https://api.anthropic.com/v1/messages');
    expect(effectiveEndpoint('openai-compatible', 'https://gateway.example/v1')).toBe('https://gateway.example/v1/chat/completions');
    expect(effectiveEndpoint('gemini', 'https://gateway.example/v1beta', 'gemini-2.5-pro')).toBe('https://gateway.example/v1beta/models/gemini-2.5-pro:generateContent');
    expect(effectiveEndpoint('gemini', '')).toBe('https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent');
  });
  it.each([
    ['anthropic', 'https://gateway.example/v1/messages'],
    ['gemini', 'https://gateway.example/v1/models/m:generateContent'],
    ['openai-compatible', 'https://gateway.example/v1/chat/completions'],
  ] as const)('uses the saved base URL for %s', async (provider, expectedUrl) => {
    proxy.mockClear();
    proxy.mockRejectedValue(new Error('test transport stopped'));
    const model = createChatModel({ provider, baseUrl: 'https://gateway.example/v1', model: 'm' });
    await expect(model.doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] })).rejects.toThrow();
    expect(String(proxy.mock.calls[0]?.[0])).toBe(expectedUrl);
  });
});
