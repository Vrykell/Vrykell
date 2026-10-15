/**
 * modelPresets — one-click fills for the model list.
 *
 * An endpoint and a model identifier are data, not logic: vendors ship new models constantly, so
 * each preset is one editable line in this table. Nothing third-party ships with the app, no key is
 * bundled, and the vendor names appear only as labels for the endpoints they name — install and
 * license what you use yourself.
 */
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

export const MODEL_PRESETS: ModelPreset[] = [
  {
    name: 'Anthropic', provider: 'anthropic', baseUrl: '', model: 'claude-sonnet-4-5',
    hint: 'Official endpoint: paste a key from the vendor console.',
  },
  {
    name: 'OpenAI', provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini',
    hint: 'Official endpoint: paste a key from the vendor console.',
  },
  {
    name: 'Google Gemini', provider: 'gemini', baseUrl: '', model: 'gemini-2.0-flash',
    hint: 'Official endpoint: paste a key from the vendor console.',
  },
  {
    name: 'DeepSeek', provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat',
    hint: 'Official endpoint: paste a key from the vendor console.',
  },
  {
    name: 'Moonshot (Kimi)', provider: 'openai-compatible', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-128k',
    hint: 'Official endpoint: paste a key from the vendor console.',
  },
  {
    name: 'Zhipu (GLM)', provider: 'openai-compatible', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-plus',
    hint: 'Official endpoint: paste a key from the vendor console.',
  },
  {
    name: 'Qwen (DashScope)', provider: 'openai-compatible', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus',
    hint: 'Official endpoint: paste a key from the vendor console.',
  },
  {
    name: 'SiliconFlow', provider: 'openai-compatible', baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3',
    hint: 'Aggregator: one key reaches many vendors.',
  },
  {
    name: 'OpenRouter', provider: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini',
    hint: 'Aggregator: one key reaches many vendors.',
  },
  {
    name: 'Groq', provider: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile',
    hint: 'Official endpoint: paste a key from the vendor console.',
  },
  {
    name: 'xAI (Grok)', provider: 'openai-compatible', baseUrl: 'https://api.x.ai/v1', model: 'grok-3-mini',
    hint: 'Official endpoint: paste a key from the vendor console.',
  },
  {
    name: 'Ollama (local)', provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5-coder:7b',
    hint: 'Local server: usually runs without a key.',
  },
];

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
