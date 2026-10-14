/**
 * vendorMark — brand hue for a model vendor, used as the row mark in the usage tables.
 *
 * The colour lives in the theme palette (`--brand-*`), so a custom theme can restyle it; a model
 * name decides the vendor first (a gateway can serve `gpt-4o-mini` under an OpenAI-compatible
 * provider), then the provider is the fallback, then a neutral ink.
 */
import type { ProviderKind } from '@features/agent/services/provider';

interface Family {
  pattern: RegExp;
  color: string;
  label: string;
}

const FAMILIES: Family[] = [
  { pattern: /claude|anthropic|sonnet|opus|haiku/i, color: 'var(--brand-anthropic)', label: 'Anthropic' },
  { pattern: /gpt-|o1\b|o3\b|o4\b|openai/i, color: 'var(--brand-openai)', label: 'OpenAI' },
  { pattern: /gemini|palm|google/i, color: 'var(--brand-gemini)', label: 'Google' },
  { pattern: /deepseek/i, color: 'var(--brand-deepseek)', label: 'DeepSeek' },
];

const PROVIDER_FALLBACK: Record<ProviderKind, string> = {
  anthropic: 'var(--brand-anthropic)',
  'openai-compatible': 'var(--brand-openai)',
  gemini: 'var(--brand-gemini)',
};

export interface VendorMark {
  /** CSS colour for the dot. */
  color: string;
  /** Vendor name for the dot's tooltip. */
  label: string;
}

export function vendorMark(provider: string, model: string): VendorMark {
  const family = FAMILIES.find((candidate) => candidate.pattern.test(model || ''));
  if (family) return { color: family.color, label: family.label };
  return {
    color: PROVIDER_FALLBACK[provider as ProviderKind] ?? 'var(--text-muted)',
    label: provider,
  };
}
