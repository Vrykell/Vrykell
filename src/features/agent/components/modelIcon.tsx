/**
 * modelIcon — the vendor mark a model entry shows (model list, picker, pill, usage tables).
 *
 * The vendor is decided the way the rest of the app decides it: the endpoint host first (a gateway
 * or a local server names the service), then the model identifier's family, then the provider kind.
 * A known vendor renders its drawn brand mark; anything else falls back to a neutral glyph — never
 * a letter tile or a generic robot, so a list shows the real service wherever one is recognisable.
 */
import {
  AnthropicMark, DeepSeekMark, GeminiMark, GroqMark, MistralMark, MoonshotMark, OllamaMark,
  OpenAIMark, OpenRouterMark, QwenMark, SiliconFlowMark, XaiMark, ZhipuMark,
} from '@ui/brandMarks';
import { Cpu, Server, type AppIcon } from '@ui/icons';
import type { ProviderKind } from '@features/agent/services/provider';

export type ModelVendor =
  | 'anthropic' | 'openai' | 'gemini' | 'deepseek' | 'moonshot' | 'zhipu' | 'qwen' | 'siliconflow'
  | 'openrouter' | 'groq' | 'xai' | 'mistral' | 'ollama' | 'local' | 'generic';

export interface VendorInfo {
  label: string;
  /** Theme colour the mark is drawn in; a `--brand-*` token when the palette defines one. */
  hue: string;
  mark: AppIcon;
  /** True when the hue is the vendor's own brand token (a caller can tint a tile with it). */
  branded: boolean;
}

const VENDORS: Record<Exclude<ModelVendor, 'generic'>, VendorInfo> = {
  anthropic: { label: 'Anthropic', hue: 'var(--brand-anthropic)', mark: AnthropicMark, branded: true },
  openai: { label: 'OpenAI', hue: 'var(--brand-openai)', mark: OpenAIMark, branded: true },
  gemini: { label: 'Gemini', hue: 'var(--brand-gemini)', mark: GeminiMark, branded: true },
  deepseek: { label: 'DeepSeek', hue: 'var(--brand-deepseek)', mark: DeepSeekMark, branded: true },
  moonshot: { label: 'Moonshot', hue: 'var(--text-secondary)', mark: MoonshotMark, branded: false },
  zhipu: { label: 'Zhipu', hue: 'var(--text-secondary)', mark: ZhipuMark, branded: false },
  qwen: { label: 'Qwen', hue: 'var(--text-secondary)', mark: QwenMark, branded: false },
  siliconflow: { label: 'SiliconFlow', hue: 'var(--text-secondary)', mark: SiliconFlowMark, branded: false },
  openrouter: { label: 'OpenRouter', hue: 'var(--text-secondary)', mark: OpenRouterMark, branded: false },
  groq: { label: 'Groq', hue: 'var(--text-secondary)', mark: GroqMark, branded: false },
  xai: { label: 'xAI', hue: 'var(--text-secondary)', mark: XaiMark, branded: false },
  mistral: { label: 'Mistral', hue: 'var(--text-secondary)', mark: MistralMark, branded: false },
  ollama: { label: 'Ollama', hue: 'var(--text-secondary)', mark: OllamaMark, branded: false },
  local: { label: 'Local server', hue: 'var(--text-secondary)', mark: Server, branded: false },
};

const HOST_RULES: [RegExp, ModelVendor][] = [
  [/anthropic\.com/, 'anthropic'],
  [/openai\.com|openai\.azure|azure-api/, 'openai'],
  [/googleapis\.com|google\.com|generativelanguage/, 'gemini'],
  [/deepseek\.com/, 'deepseek'],
  [/moonshot\.(cn|ai)|kimi\.com/, 'moonshot'],
  [/bigmodel\.cn|zhipu/, 'zhipu'],
  [/dashscope\.|aliyuncs\.com|bailian/, 'qwen'],
  [/siliconflow\./, 'siliconflow'],
  [/openrouter\.ai/, 'openrouter'],
  [/groq\.com/, 'groq'],
  [/x\.ai/, 'xai'],
  [/mistral\.ai/, 'mistral'],
];

const MODEL_RULES: [RegExp, ModelVendor][] = [
  [/claude|sonnet|opus|haiku/, 'anthropic'],
  [/gpt|chatgpt|davinci|codex|^o[134]/, 'openai'],
  [/gemini|gemma|palm/, 'gemini'],
  [/deepseek/, 'deepseek'],
  [/moonshot|kimi/, 'moonshot'],
  [/^glm|zhipu/, 'zhipu'],
  [/qwen|qwq/, 'qwen'],
  [/grok/, 'xai'],
  [/mistral|mixtral|codestral/, 'mistral'],
];

/** Loopback and LAN endpoints serve whatever the user runs there, never a vendor cloud. */
const LOCAL_HOSTS = /^(localhost|127(\.\d+){3}|0\.0\.0\.0|\[?::1\]?|host\.docker\.internal|10(\.\d+){3}|192\.168(\.\d+){2}|172\.(1[6-9]|2\d|3[01])(\.\d+){2})$/;

function endpointHost(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).host.toLowerCase();
  } catch {
    return '';
  }
}

function localVendor(host: string): ModelVendor | null {
  if (!LOCAL_HOSTS.test(host.replace(/:\d+$/, ''))) return null;
  return host.endsWith(':11434') ? 'ollama' : 'local';
}

/** The vendor of one model entry, host first, then the model family, then the provider kind. */
export function modelVendor(kind: string, model: string, baseUrl = ''): ModelVendor {
  const host = endpointHost(baseUrl);
  if (host) {
    for (const [pattern, vendor] of HOST_RULES) if (pattern.test(host)) return vendor;
    const local = localVendor(host);
    if (local) return local;
  }
  const name = (model || '').toLowerCase();
  for (const [pattern, vendor] of MODEL_RULES) if (pattern.test(name)) return vendor;
  if (kind === 'anthropic') return 'anthropic';
  if (kind === 'gemini') return 'gemini';
  return 'generic';
}

/** Label, hue and mark for an entry; unknown vendors keep the provider string as the label. */
export function modelVendorInfo(kind: string, model: string, baseUrl = ''): VendorInfo {
  const vendor = modelVendor(kind, model, baseUrl);
  if (vendor !== 'generic') return VENDORS[vendor];
  return { label: kind, hue: 'var(--text-muted)', mark: Cpu, branded: false };
}

export function modelMark(kind: string, model: string, baseUrl = ''): AppIcon {
  return modelVendorInfo(kind, model, baseUrl).mark;
}

export function modelHue(kind: string, model: string, baseUrl = ''): string {
  return modelVendorInfo(kind, model, baseUrl).hue;
}

export function providerLabel(provider: ProviderKind): string {
  switch (provider) {
    case 'anthropic':
      return 'Anthropic';
    case 'gemini':
      return 'Gemini';
    default:
      return 'OpenAI 兼容';
  }
}
