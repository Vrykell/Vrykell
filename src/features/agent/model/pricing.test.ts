import { describe, expect, it } from 'vitest';
import { costUsd, formatUsd, priceFor, turnCostUsd } from '@features/agent/model/pricing';

describe('priceFor', () => {
  it('matches provider-bound rules before generic ones', () => {
    expect(priceFor('anthropic', 'claude-sonnet-4-5')).toMatchObject({ input: 3, output: 15 });
    expect(priceFor('anthropic', 'claude-opus-4-1')).toMatchObject({ input: 15, output: 75 });
    expect(priceFor('anthropic', 'claude-haiku-4-5')).toMatchObject({ input: 1, output: 5 });
    expect(priceFor('gemini', 'gemini-2.5-pro')).toMatchObject({ input: 1.25, output: 10 });
  });

  it('prices OpenAI-family names regardless of the gateway provider', () => {
    expect(priceFor('openai-compatible', 'gpt-4o-mini')).toMatchObject({ input: 0.15 });
    expect(priceFor('openai-compatible', 'deepseek-chat')).toMatchObject({ input: 0.27 });
    // 网关上的 gpt-5 不误判成 gpt-5-mini
    expect(priceFor('openai-compatible', 'gpt-5')).toMatchObject({ input: 1.25 });
    expect(priceFor('openai-compatible', 'gpt-5-mini')).toMatchObject({ input: 0.25 });
  });

  it('reports unknown models and empty ids as unknown', () => {
    expect(priceFor('openai-compatible', 'some-local-llama')).toBeNull();
    expect(priceFor('anthropic', '')).toBeNull();
    expect(turnCostUsd('openai-compatible', 'some-local-llama', { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 })).toBeNull();
  });
});

describe('costUsd', () => {
  it('bills cached input at its own rate and the rest at the input rate', () => {
    const price = { input: 3, output: 15, cacheRead: 0.3 };
    // 400 fresh × 3 + 800 cached × 0.3 + 300 out × 15 = 1200 + 240 + 4500 µ$
    expect(costUsd(price, { inputTokens: 1200, cachedInputTokens: 800, outputTokens: 300 })).toBeCloseTo(0.00594, 6);
    // 缓存数大于输入总数时按输入总数封顶（provider 口径不一致时的兜底）
    expect(costUsd(price, { inputTokens: 100, cachedInputTokens: 500, outputTokens: 0 })).toBeCloseTo(0.00003, 6);
    // 没有缓存价时按输入价计
    expect(costUsd({ input: 1, output: 2 }, { inputTokens: 1000, cachedInputTokens: 400, outputTokens: 0 })).toBeCloseTo(0.001, 6);
  });
});

describe('formatUsd', () => {
  it('keeps small amounts readable and rounds large ones to cents', () => {
    expect(formatUsd(0)).toBe('$0');
    expect(formatUsd(0.0000045)).toBe('<$0.0001');
    expect(formatUsd(0.0004)).toBe('$0.0004');
    expect(formatUsd(0.0432)).toBe('$0.043');
    expect(formatUsd(12.3456)).toBe('$12.35');
  });
});
