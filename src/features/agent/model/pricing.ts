/**
 * pricing — built-in reference prices behind the usage panel's cost estimate.
 *
 * Values are USD per million tokens, shaped the way providers publish them (input, output and
 * the cheaper cached-input rate). They are a *reference*, not a contract: providers change
 * prices, so a model missing from the table is reported as unknown instead of guessed — the
 * panel excludes it from the total and says how many turns were left out.
 *
 * Most-specific patterns come first; provider-bound rules are matched before the generic ones
 * so a gateway can serve the same model id under a different provider.
 */
import type { ProviderKind } from '@features/agent/services/provider';

export interface Price {
  /** USD per million input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
  /** Cached input read rate; falls back to the input rate when absent. */
  cacheRead?: number;
}

interface Rule {
  provider?: ProviderKind;
  match: RegExp;
  price: Price;
}

const RULES: Rule[] = [
  // ── Anthropic ──
  { provider: 'anthropic', match: /opus-4/i, price: { input: 15, output: 75, cacheRead: 1.5 } },
  { provider: 'anthropic', match: /sonnet-4|sonnet-3[.-]7|sonnet-3[.-]5/i, price: { input: 3, output: 15, cacheRead: 0.3 } },
  { provider: 'anthropic', match: /haiku-4[.-]5/i, price: { input: 1, output: 5, cacheRead: 0.1 } },
  { provider: 'anthropic', match: /haiku-3[.-]5/i, price: { input: 0.8, output: 4, cacheRead: 0.08 } },
  // ── Google ──
  { provider: 'gemini', match: /2[.-]5-pro/i, price: { input: 1.25, output: 10, cacheRead: 0.31 } },
  { provider: 'gemini', match: /2[.-]5-flash/i, price: { input: 0.3, output: 2.5, cacheRead: 0.075 } },
  { provider: 'gemini', match: /2[.-]0-flash/i, price: { input: 0.1, output: 0.4, cacheRead: 0.025 } },
  // ── OpenAI 家族（网关上也常以同名转发） ──
  { match: /gpt-5-mini/i, price: { input: 0.25, output: 2, cacheRead: 0.025 } },
  { match: /gpt-5(?!-)/i, price: { input: 1.25, output: 10, cacheRead: 0.125 } },
  { match: /gpt-4o-mini/i, price: { input: 0.15, output: 0.6, cacheRead: 0.075 } },
  { match: /gpt-4o/i, price: { input: 2.5, output: 10, cacheRead: 1.25 } },
  { match: /gpt-4[.-]1-mini/i, price: { input: 0.4, output: 1.6, cacheRead: 0.1 } },
  { match: /gpt-4[.-]1/i, price: { input: 2, output: 8, cacheRead: 0.5 } },
  { match: /o4-mini/i, price: { input: 1.1, output: 4.4, cacheRead: 0.275 } },
  { match: /(^|[-/])o3(?!-mini)/i, price: { input: 2, output: 8, cacheRead: 0.5 } },
  // ── DeepSeek ──
  { match: /deepseek-reasoner|deepseek-r1/i, price: { input: 0.55, output: 2.19, cacheRead: 0.14 } },
  { match: /deepseek-chat|deepseek-v3/i, price: { input: 0.27, output: 1.1, cacheRead: 0.07 } },
];

/** Price for a model, or null when the table does not know it (never a guess). */
export function priceFor(provider: ProviderKind, model: string): Price | null {
  const name = (model || '').trim();
  if (!name) return null;
  const bound = RULES.find((rule) => rule.provider === provider && rule.match.test(name));
  if (bound) return bound.price;
  const generic = RULES.find((rule) => !rule.provider && rule.match.test(name));
  return generic ? generic.price : null;
}

export interface BillableTokens {
  /** Total input tokens as the provider reported them (cached tokens included). */
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

/** USD for one turn; cached input is billed at its own rate, the rest at the input rate. */
export function costUsd(price: Price, tokens: BillableTokens): number {
  const cached = Math.max(0, Math.min(tokens.cachedInputTokens, tokens.inputTokens));
  const fresh = Math.max(0, tokens.inputTokens - cached);
  const cacheRead = price.cacheRead ?? price.input;
  return (fresh * price.input + cached * cacheRead + tokens.outputTokens * price.output) / 1_000_000;
}

/** Cost of one turn, or null when the model has no known price. */
export function turnCostUsd(
  provider: ProviderKind,
  model: string,
  tokens: BillableTokens,
): number | null {
  const price = priceFor(provider, model);
  return price ? costUsd(price, tokens) : null;
}

/** Compact money formatting for the panel: cents are enough above a dollar. */
export function formatUsd(value: number): string {
  if (value === 0) return '$0';
  // Below a ten-thousandth of a dollar the four-digit form would read as "$0.0000"
  if (value < 0.0001) return '<$0.0001';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}
