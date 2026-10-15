import { describe, expect, it } from 'vitest';
import { MODEL_PRESETS, applyModelPreset, type ModelPreset } from '@config/modelPresets';

const preset = (patch: Partial<ModelPreset> = {}): ModelPreset => ({
  name: 'DeepSeek', provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat', hint: 'Official endpoint: paste a key from the vendor console.', ...patch,
});

describe('MODEL_PRESETS', () => {
  it('names a provider, an endpoint or a default one, and a model for every entry', () => {
    for (const entry of MODEL_PRESETS) {
      expect(entry.name.trim()).not.toBe('');
      expect(entry.model.trim()).not.toBe('');
      expect(entry.hint.trim()).not.toBe('');
      // The endpoint may be empty (the provider layer knows the vendor default) but never a bare host.
      if (entry.baseUrl) expect(entry.baseUrl).toMatch(/^https?:\/\/.+\/v\d|^https?:\/\/localhost/);
    }
  });

  it('keeps presets distinct, so one click cannot add two identical rows', () => {
    const seen = MODEL_PRESETS.map((entry) => `${entry.provider}|${entry.baseUrl}|${entry.model}`);
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe('applyModelPreset', () => {
  it('appends the preset and returns the id it should activate', () => {
    const result = applyModelPreset<{ id: string; name: string; provider: string; baseUrl: string; model: string }>(
      [], preset(), () => 'new-id',
    );

    expect(result.id).toBe('new-id');
    expect(result.models).toEqual([
      { id: 'new-id', name: 'DeepSeek', provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    ]);
  });

  it('selects the entry that already matches instead of adding a duplicate', () => {
    const existing = [
      { id: 'old', name: 'Mine', provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    ];

    const result = applyModelPreset(existing, preset(), () => 'unused');

    expect(result.models).toBe(existing);
    expect(result.id).toBe('old');
  });

  it('treats the same model on a different endpoint as a different entry', () => {
    const existing = [
      { id: 'gateway', name: 'Gateway', provider: 'openai-compatible', baseUrl: 'https://gateway.example/v1', model: 'deepseek-chat' },
    ];

    const result = applyModelPreset(existing, preset(), () => 'second');

    expect(result.models).toHaveLength(2);
    expect(result.id).toBe('second');
  });
});
