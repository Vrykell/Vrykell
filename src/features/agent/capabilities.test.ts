/**
 * capabilities — model capability detection rule tests.
 */
import { describe, it, expect } from 'vitest';
import { capabilityLabel, detectCapabilities, hasCapability, type ModelCapability } from '@features/agent/model/capabilities';
import { t } from '@i18n';

describe('detectCapabilities', () => {
  it('anthropic / gemini: native vision and search, modern models have reasoning', () => {
    const c = detectCapabilities('anthropic', 'claude-sonnet-5');
    expect(c.vision).toBe(true);
    expect(c.search).toBe(true);
    expect(c.reasoning).toBe(true);
    expect(c.tools).toBe(true);
    const g = detectCapabilities('gemini', 'gemini-2.5-flash');
    expect(g.vision).toBe(true);
    expect(g.search).toBe(true);
  });

  it('openai-compatible: vision/reasoning decided by model name, no native search', () => {
    const gpt4o = detectCapabilities('openai-compatible', 'gpt-4o');
    expect(gpt4o.vision).toBe(true);
    expect(gpt4o.reasoning).toBe(false);
    expect(gpt4o.search).toBe(false);
    expect(gpt4o.tools).toBe(true);

    const o1 = detectCapabilities('openai-compatible', 'o1-mini');
    expect(o1.reasoning).toBe(true);
    expect(o1.vision).toBe(true);

    const qwenVl = detectCapabilities('openai-compatible', 'qwen2.5-vl-7b');
    expect(qwenVl.vision).toBe(true);

    const r1 = detectCapabilities('openai-compatible', 'deepseek-r1');
    expect(r1.reasoning).toBe(true);
    expect(r1.vision).toBe(false);
  });

  it('embedding/transcription models do not support tools', () => {
    const emb = detectCapabilities('openai-compatible', 'text-embedding-3-small');
    expect(emb.tools).toBe(false);
    const tts = detectCapabilities('openai-compatible', 'tts-1');
    expect(tts.tools).toBe(false);
    // ordinary models support tools by default
    const plain = detectCapabilities('openai-compatible', 'gpt-3.5-turbo');
    expect(plain.tools).toBe(true);
  });

  it('hasCapability: falls back to heuristics when the profile is missing', () => {
    expect(hasCapability(undefined, 'vision', 'anthropic', 'claude-sonnet-5')).toBe(true);
    expect(hasCapability(undefined, 'search', 'openai-compatible', 'gpt-4o')).toBe(false);
    expect(hasCapability({ vision: false, reasoning: false, tools: true, search: false }, 'vision', 'anthropic', 'x')).toBe(false);
    expect(hasCapability({ vision: true, reasoning: false, tools: true, search: false }, 'vision', 'openai-compatible', 'x')).toBe(true);
  });

  it('label text is complete', () => {
    expect((['vision', 'reasoning', 'tools', 'search'] as ModelCapability[]).map(capabilityLabel)).toEqual([
      t('Vision'), t('Reasoning'), t('Tools'), t('Search'),
    ]);
  });
});
