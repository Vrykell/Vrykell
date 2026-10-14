import { describe, expect, it } from 'vitest';
import { vendorMark } from '@features/agent/components/usage/vendorColor';

describe('vendorMark', () => {
  it('prefers the model family so a gateway still shows the vendor hue', () => {
    expect(vendorMark('openai-compatible', 'gpt-4o-mini')).toEqual({ color: 'var(--brand-openai)', label: 'OpenAI' });
    expect(vendorMark('openai-compatible', 'deepseek-chat')).toEqual({ color: 'var(--brand-deepseek)', label: 'DeepSeek' });
    expect(vendorMark('anthropic', 'claude-sonnet-4')).toEqual({ color: 'var(--brand-anthropic)', label: 'Anthropic' });
    expect(vendorMark('gemini', 'gemini-2.5-pro')).toEqual({ color: 'var(--brand-gemini)', label: 'Google' });
  });

  it('falls back to the provider and then to a neutral ink', () => {
    expect(vendorMark('anthropic', 'internal-preview')).toEqual({ color: 'var(--brand-anthropic)', label: 'anthropic' });
    expect(vendorMark('openai-compatible', 'qwen2.5')).toEqual({ color: 'var(--brand-openai)', label: 'openai-compatible' });
    expect(vendorMark('custom-gateway', 'llama-3')).toEqual({ color: 'var(--text-muted)', label: 'custom-gateway' });
  });
});
