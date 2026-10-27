/**
 * provider — build model SDK instances from the current configuration.
 *
 * Every instance gets createProxyFetch() injected: requests actually go out through the backend
 * llm_stream proxy, which attaches the real API key. The apiKey placeholder here never reaches the
 * network (the backend discards and replaces the auth header).
 */
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { Tool } from 'ai';
import { createProxyFetch } from '@features/agent/services/llmFetch';
import { DEFAULT_BASE_URLS, type ProviderKind } from '@config/providers';

export type { ProviderKind };

export function baseUrlForProvider(baseUrl: string, provider: ProviderKind): string {
  const current = baseUrl.trim().replace(/\/+$/, '');
  return !current || Object.values(DEFAULT_BASE_URLS).includes(current)
    ? DEFAULT_BASE_URLS[provider] : baseUrl;
}

/** The base URL a request will actually use: defaults resolved, trailing slashes trimmed. */
export function effectiveBaseUrl(kind: ProviderKind, baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  return baseUrlForProvider(trimmed, kind).replace(/\/+$/, '');
}

/** Stable identity of one provider (endpoint): the API family plus the effective base URL. */
export function providerId(kind: ProviderKind, baseUrl: string): string {
  return `${kind}|${effectiveBaseUrl(kind, baseUrl)}`;
}

/**
 * The request URL a model call actually reaches: the provider SDK appends this path to the
 * configured base, so the settings page can show where requests really go.
 */
export function effectiveEndpoint(kind: ProviderKind, baseUrl: string, model = ''): string {
  const base = (baseUrl.trim() || DEFAULT_BASE_URLS[kind]).replace(/\/+$/, '');
  switch (kind) {
    case 'anthropic':
      return `${base}/messages`;
    case 'gemini':
      return `${base}/models/${model.trim() || '{model}'}:generateContent`;
    default:
      return `${base}/chat/completions`;
  }
}

export interface ChatModelConfig {
  provider: ProviderKind;
  baseUrl: string;
  model: string;
  /** Conversation scope for endpoints that route requests by a session header. */
  sessionId?: string;
}

const proxyFetches = new Map<string, typeof fetch>();

function getProxyFetch(provider: ProviderKind, sessionId?: string): typeof fetch {
  const key = `${provider}|${sessionId ?? ''}`;
  let proxy = proxyFetches.get(key);
  if (!proxy) { proxy = createProxyFetch(provider, sessionId); proxyFetches.set(key, proxy); }
  return proxy;
}

export function createChatModel(cfg: ChatModelConfig) {
  const fetchImpl = getProxyFetch(cfg.provider, cfg.sessionId);
  switch (cfg.provider) {
    case 'anthropic':
      return createAnthropic({ baseURL: cfg.baseUrl, apiKey: 'proxy-managed', fetch: fetchImpl })(cfg.model);
    case 'gemini':
      return createGoogleGenerativeAI({ baseURL: cfg.baseUrl, apiKey: 'proxy-managed', fetch: fetchImpl })(cfg.model);
    default:
      return createOpenAICompatible({
        name: 'vrykell',
        baseURL: cfg.baseUrl,
        apiKey: 'proxy-managed',
        fetch: fetchImpl,
      })(cfg.model);
  }
}

/**
 * Native web search tool (executed server-side by the provider, no local execute).
 * Returns the key to use in the tool table plus the tool instance; openai-compatible has no
 * native capability and returns null (the caller falls back to the hosted search API).
 * Anthropic requires the key `web_search` and Gemini `google_search` (the provider identifies
 * them by name).
 */
export function createNativeWebSearchTool(
  provider: ProviderKind,
): { name: string; tool: Tool } | null {
  const fetchImpl = getProxyFetch(provider);
  switch (provider) {
    case 'anthropic':
      return {
        name: 'web_search',
        tool: createAnthropic({ apiKey: 'proxy-managed', fetch: fetchImpl }).tools
          .webSearch_20250305({ maxUses: 5 }) as Tool,
      };
    case 'gemini':
      return {
        name: 'google_search',
        tool: createGoogleGenerativeAI({ apiKey: 'proxy-managed', fetch: fetchImpl }).tools
          .googleSearch({}) as Tool,
      };
    default:
      return null;
  }
}

/**
 * Deep-thinking switch → streamText providerOptions.
 * The openai-compatible key is the name passed to the provider factory ('vrykell'), which the SDK
 * merges into the request body; when Anthropic thinking is enabled, the caller must also raise
 * maxOutputTokens above budgetTokens (a hard API constraint).
 */
/** JSON subset used by providerOptions (the SDK's ProviderOptions type is not exported from the package root). */
type Jsonish = string | number | boolean | { [k: string]: Jsonish };

export type ThinkingLevel = 'low' | 'medium' | 'high';

/** The only endpoint whose thinking blocks the SDK can echo back reliably. An empty base URL is
 *  the vendor default, i.e. the official endpoint. */
export function supportsThinkingPassback(baseUrl: string): boolean {
  if (!baseUrl) return true;
  try {
    return new URL(baseUrl).host.toLowerCase() === 'api.anthropic.com';
  } catch {
    return false;
  }
}

export function deepThinkProviderOptions(
  provider: ProviderKind,
  level: ThinkingLevel = 'high',
  baseUrl = '',
  wanted = true,
): Record<string, Record<string, Jsonish>> {
  switch (provider) {
    case 'anthropic': {
      // Thinking blocks must be echoed back on every follow-up request once tools are in play.
      // A compatibility endpoint (DeepSeek's shim, say) cannot round-trip them, and leaving the
      // option out does not turn its thinking mode off — the model's default still produces
      // reasoning and the follow-up then fails with HTTP 400 "content[].thinking ... must be
      // passed back". Those endpoints get an explicit disable instead.
      if (!supportsThinkingPassback(baseUrl)) {
        return { anthropic: { thinking: { type: 'disabled' } } };
      }
      if (!wanted) return {};
      return { anthropic: { thinking: { type: 'enabled', budgetTokens: level === 'low' ? 4000 : level === 'medium' ? 8000 : 16000 } } };
    }
    case 'gemini':
      if (!wanted) return {};
      return { google: { thinkingConfig: { thinkingBudget: level === 'low' ? 4096 : level === 'medium' ? 8192 : 16384 } } };
    default:
      if (!wanted) return {};
      return { vrykell: { reasoning_effort: level } };
  }
}
