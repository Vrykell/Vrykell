import { describe, expect, it } from 'vitest';
import { DEFAULT_BASE_URLS, PROVIDERS, providerDefinition, sessionHeaderFor } from './providers';

describe('provider catalog', () => {
  it('defines one default endpoint and label per family', () => {
    const kinds = PROVIDERS.map((provider) => provider.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    for (const provider of PROVIDERS) {
      expect(provider.label.trim()).not.toBe('');
      expect(provider.defaultBaseUrl).toMatch(/^https:\/\//);
      expect(DEFAULT_BASE_URLS[provider.kind]).toBe(provider.defaultBaseUrl);
    }
    expect(providerDefinition('opencode').defaultBaseUrl).toBe('https://opencode.ai/zen/go/v1');
  });

  it('routes a conversation only on the hosts the catalog names', () => {
    expect(sessionHeaderFor('https://opencode.ai/zen/go/v1/chat/completions')).toBe('x-opencode-session');
    expect(sessionHeaderFor('https://edge.opencode.ai/zen/go/v1/chat/completions')).toBe('x-opencode-session');
    expect(sessionHeaderFor('https://notopencode.ai/v1/chat/completions')).toBeNull();
    expect(sessionHeaderFor('https://api.openai.com/v1/chat/completions')).toBeNull();
    expect(sessionHeaderFor('not a url')).toBeNull();
  });
});
