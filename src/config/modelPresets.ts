/**
 * modelPresets — one-click fills for the model list.
 *
 * The endpoint table is data, not logic: it lives in `modelPresets.json` next to this file, so a
 * vendor's endpoint or model id can change without touching code. The vendor names and marks point
 * at the endpoints they name, no key is bundled, and install and license what you use yourself.
 */
import presetData from './modelPresets.json';

export type ModelPresetProvider = 'openai-compatible' | 'anthropic' | 'gemini';

export type ModelPresetHint =
  | 'Official endpoint: paste a key from the vendor console.'
  | 'Aggregator: one key reaches many vendors.'
  | 'Local server: usually runs without a key.';

export interface ModelPreset {
  /** Shown on the button; the vendor's own name, used as a label only. */
  name: string;
  provider: ModelPresetProvider;
  /** Empty means the vendor's default endpoint (the provider layer knows it). */
  baseUrl: string;
  model: string;
  /** One line about what this endpoint is and where the key comes from. */
  hint: ModelPresetHint;
}

export const MODEL_PRESETS: ModelPreset[] = presetData.map((entry) => ({
  name: entry.name,
  provider: entry.provider as ModelPresetProvider,
  baseUrl: entry.baseUrl,
  model: entry.model,
  hint: entry.hint as ModelPresetHint,
}));

/** What the model list should become, and which entry the active model should point at. */
export interface ModelPresetResult<T> {
  models: T[];
  id: string;
}

/**
 * Add a preset to a model list, or select the entry that already matches it.
 *
 * "Matches" means the same provider, endpoint and model identifier, so picking a preset twice is a
 * jump to the existing model rather than a duplicate row. The id generator is a parameter to keep
 * the result deterministic.
 */
export function applyModelPreset<T extends { id: string; provider: string; baseUrl: string; model: string }>(
  current: T[],
  preset: ModelPreset,
  nextId: () => string,
): ModelPresetResult<T> {
  const existing = current.find(
    (entry) => entry.provider === preset.provider && entry.baseUrl === preset.baseUrl && entry.model === preset.model,
  );
  if (existing) return { models: current, id: existing.id };
  const id = nextId();
  const entry = { id, name: preset.name, provider: preset.provider, baseUrl: preset.baseUrl, model: preset.model } as unknown as T;
  return { models: [...current, entry], id };
}
