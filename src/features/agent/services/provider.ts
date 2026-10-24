/**
 * provider — 按当前配置构造 AI SDK model 实例。
 *
 * 所有实例都注入 createProxyFetch()：请求实际经 Rust llm_stream 代理发出，
 * 真实 API key 由 Rust 附加，这里的 apiKey 占位值不会出现在网络请求里
 * （Rust 侧会丢弃并替换认证头）。
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
 * 原生联网搜索工具（provider 服务端执行，无本地 execute）。
 * 返回工具表里的键名 + 工具实例；openai-compatible 无原生能力返回 null
 * （由调用方用 Tavily 兜底）。anthropic 的键名必须是 web_search，
 * gemini 必须是 google_search（provider 侧按名字识别）。
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
 * 深思考开关 → streamText providerOptions。
 * openai-compatible 的键名 = createOpenAICompatible 的 name（'vrykell'），
 * SDK 会把它合并进请求体；anthropic 开启 thinking 时调用方还需把
 * maxOutputTokens 抬到 budgetTokens 之上（API 硬性约束）。
 */
/** providerOptions 用的 JSON 子集类型（SDK 的 ProviderOptions 未从 'ai' 顶层导出） */
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
