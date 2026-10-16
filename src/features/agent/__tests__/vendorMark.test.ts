import { describe, expect, it } from 'vitest';
import { vendorMark } from '@features/agent/components/usage/vendorColor';
import { AnthropicMark, DeepSeekMark, GeminiMark, MoonshotMark, OpenAIMark, QwenMark } from '@ui/brandMarks';
import { Cpu } from '@ui/icons';

describe('vendorMark', () => {
  it('prefers the model family so a gateway still shows the vendor mark', () => {
    expect(vendorMark('openai-compatible', 'gpt-4o-mini')).toMatchObject({ color: 'var(--brand-openai)', label: 'OpenAI', icon: OpenAIMark });
    expect(vendorMark('openai-compatible', 'deepseek-chat')).toMatchObject({ color: 'var(--brand-deepseek)', label: 'DeepSeek', icon: DeepSeekMark });
    expect(vendorMark('anthropic', 'claude-sonnet-4')).toMatchObject({ color: 'var(--brand-anthropic)', label: 'Anthropic', icon: AnthropicMark });
    expect(vendorMark('gemini', 'gemini-2.5-pro')).toMatchObject({ color: 'var(--brand-gemini)', label: 'Gemini', icon: GeminiMark });
  });

  it('names a third-party family with its own drawn mark', () => {
    expect(vendorMark('openai-compatible', 'qwen2.5')).toMatchObject({ label: 'Qwen', icon: QwenMark });
    expect(vendorMark('openai-compatible', 'kimi-k2')).toMatchObject({ label: 'Moonshot', icon: MoonshotMark });
  });

  it('falls back to the provider and then to a neutral ink', () => {
    expect(vendorMark('anthropic', 'internal-preview')).toMatchObject({ color: 'var(--brand-anthropic)', label: 'Anthropic' });
    expect(vendorMark('custom-gateway', 'llama-3')).toMatchObject({ color: 'var(--text-muted)', label: 'custom-gateway', icon: Cpu });
  });
});
