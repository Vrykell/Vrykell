import { describe, expect, it } from 'vitest';
import type { ProviderKind } from '@features/agent/services/provider';
import {
  effectiveBaseUrl,
  providerHasKey,
  providerId,
  providerList,
  providerName,
} from './providerList';

describe('effectiveBaseUrl', () => {
  it('an empty string resolves to the default endpoint for that kind', () => {
    expect(effectiveBaseUrl('anthropic', '')).toBe('https://api.anthropic.com/v1');
    expect(effectiveBaseUrl('openai-compatible', '  ')).toBe('https://api.openai.com/v1');
    expect(effectiveBaseUrl('opencode', '')).toBe('https://opencode.ai/zen/go/v1');
  });

  it('the default endpoint and its trailing-slash form normalize to the same value', () => {
    expect(effectiveBaseUrl('anthropic', 'https://api.anthropic.com/v1/')).toBe('https://api.anthropic.com/v1');
    expect(effectiveBaseUrl('openai-compatible', 'https://api.deepseek.com/v1/')).toBe('https://api.deepseek.com/v1');
  });

  it('custom endpoints only lose the trailing slash', () => {
    expect(effectiveBaseUrl('openai-compatible', 'http://127.0.0.1:11434/v1')).toBe('http://127.0.0.1:11434/v1');
  });
});

describe('providerName', () => {
  it('a preset match uses the preset name (an empty string matches the default endpoint)', () => {
    expect(providerName('anthropic', '')).toBe('Anthropic');
    expect(providerName('anthropic', 'https://api.anthropic.com/v1')).toBe('Anthropic');
    expect(providerName('openai-compatible', 'https://api.deepseek.com/v1')).toBe('DeepSeek');
    expect(providerName('opencode', '')).toBe('OpenCode Go');
    expect(providerName('opencode', 'https://opencode.ai/zen/v1')).toBe('OpenCode Zen');
  });

  it('a preset miss falls back to the hostname', () => {
    expect(providerName('openai-compatible', 'http://127.0.0.1:11434/v1')).toBe('127.0.0.1:11434');
  });

  it('an unparsable address returns an empty name (the UI falls back to the family label)', () => {
    expect(providerName('openai-compatible', 'not a url')).toBe('');
  });
});

describe('providerList', () => {
  const row = (id: string, provider: ProviderKind, baseUrl: string) => ({ id, provider, baseUrl });

  it('groups by kind+endpoint in first-appearance order and assigns models to their provider', () => {
    const rows = providerList([
      row('a', 'anthropic', ''),
      row('b', 'openai-compatible', 'https://api.deepseek.com/v1'),
      row('c', 'anthropic', 'https://api.anthropic.com/v1/'),
      row('d', 'openai-compatible', 'https://api.deepseek.com/v1/'),
    ]);
    expect(rows.map((entry) => entry.id)).toEqual([
      'anthropic|https://api.anthropic.com/v1',
      'openai-compatible|https://api.deepseek.com/v1',
    ]);
    expect(rows[0].models.map((model) => model.id)).toEqual(['a', 'c']);
    expect(rows[1].models.map((model) => model.id)).toEqual(['b', 'd']);
    expect(rows[0].name).toBe('Anthropic');
    expect(rows[1].name).toBe('DeepSeek');
  });

  it('different endpoints get separate rows; an empty list returns an empty array', () => {
    const rows = providerList([
      row('x', 'openai-compatible', 'http://127.0.0.1:11434/v1'),
      row('y', 'openai-compatible', 'https://api.moonshot.cn/v1'),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].id).not.toBe(rows[1].id);
    expect(providerList([])).toEqual([]);
  });
});

describe('providerHasKey / providerId', () => {
  it('reads the key flag by provider identity', () => {
    const flags = { providerKeys: ['anthropic|https://api.anthropic.com/v1'] };
    expect(providerHasKey('anthropic|https://api.anthropic.com/v1', flags)).toBe(true);
    expect(providerHasKey('openai-compatible|https://api.openai.com/v1', flags)).toBe(false);
    expect(providerHasKey('gemini|https://generativelanguage.googleapis.com/v1beta', flags)).toBe(false);
  });

  it('the id follows the same endpoint normalization', () => {
    expect(providerId('anthropic', '')).toBe(providerId('anthropic', 'https://api.anthropic.com/v1/'));
  });
});
