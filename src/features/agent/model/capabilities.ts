/**
 * Model capability detection, applied when a model is created or imported.
 *
 * Four dimensions: vision (image input), reasoning (thinking mode), tools (tool calling) and
 * search (native provider search rather than a third-party fallback). Detection is a zero-cost
 * heuristic over provider and model name; the result persists with ModelProfile and labels the
 * settings page and model picker.
 */
import type { ProviderKind } from '@features/agent/services/provider';
import { t, type I18nKey } from '@i18n';

export type ModelCapability = 'vision' | 'reasoning' | 'tools' | 'search';

export interface ModelCapabilities {
  vision: boolean;
  reasoning: boolean;
  tools: boolean;
  search: boolean;
}

const CAPABILITY_LABEL_KEYS: Record<ModelCapability, I18nKey> = {
  vision: 'Vision',
  reasoning: 'Reasoning',
  tools: 'Tools',
  search: 'Search',
};

/** Capability label in the current interface language. */
export function capabilityLabel(cap: ModelCapability): string {
  return t(CAPABILITY_LABEL_KEYS[cap]);
}

/** Native provider search: built into Anthropic and Gemini, absent for OpenAI-compatible APIs. */
const NATIVE_SEARCH_PROVIDERS = new Set<ProviderKind>(['anthropic', 'gemini']);

/** Tool calling: embedding, speech and transcription models do not support it. */
const NO_TOOLS_RE = /embedding|rerank|tts|whisper|transcri|moderation|dall-e|image/i;

/** Reasoning: name heuristic; current Anthropic and Gemini models support thinking modes. */
const REASONING_RE =
  /reasoner|reasoning|thinking|think|o1|o3|o4|gpt-5|deepseek-r1|deepseek-.*-reasoner|kimi.*thinking|glm-4\.5|glm-4\.6|qwen3|qwen3-|moonshot-v1|doubao-.*-think|claude-sonnet|claude-opus|gemini-2\.5/g;

/** Vision: name heuristic; Anthropic and Gemini support it natively. */
const VISION_RE =
  /gpt-4o|gpt-4\.1|gpt-5|o1|o3|o4|vision|\bvl\b|qwen.*vl|qwen2\.5-vl|glm-4v|glm-4\.1v|claude|gemini|minicpm|internvl|phi-4|pixtral|llava|step-1v/i;

export function detectCapabilities(provider: ProviderKind, model: string): ModelCapabilities {
  const m = model || '';
  return {
    vision: provider === 'anthropic' || provider === 'gemini' || VISION_RE.test(m),
    reasoning: REASONING_RE.test(m),
    tools: !NO_TOOLS_RE.test(m),
    search: NATIVE_SEARCH_PROVIDERS.has(provider),
  };
}

/** Whether a model has a capability; the heuristic covers profiles that were never probed. */
export function hasCapability(
  caps: ModelCapabilities | undefined,
  capability: ModelCapability,
  provider: ProviderKind,
  model: string,
): boolean {
  if (!caps) return detectCapabilities(provider, model)[capability];
  return caps[capability];
}
