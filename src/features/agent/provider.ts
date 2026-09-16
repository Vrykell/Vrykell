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
import { createProxyFetch } from '@features/agent/llmFetch';

export type ProviderKind = 'openai-compatible' | 'anthropic' | 'gemini';

export interface ChatModelConfig {
  provider: ProviderKind;
  baseUrl: string;
  model: string;
}

let proxyFetch: typeof fetch | null = null;

function getProxyFetch(): typeof fetch {
  proxyFetch ??= createProxyFetch();
  return proxyFetch;
}

export function createChatModel(cfg: ChatModelConfig) {
  const fetchImpl = getProxyFetch();
  switch (cfg.provider) {
    case 'anthropic':
      return createAnthropic({ apiKey: 'proxy-managed', fetch: fetchImpl })(cfg.model);
    case 'gemini':
      return createGoogleGenerativeAI({ apiKey: 'proxy-managed', fetch: fetchImpl })(cfg.model);
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
  const fetchImpl = getProxyFetch();
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

export function deepThinkProviderOptions(
  provider: ProviderKind,
  level: ThinkingLevel = 'high',
): Record<string, Record<string, Jsonish>> {
  switch (provider) {
    case 'anthropic':
      return { anthropic: { thinking: { type: 'enabled', budgetTokens: level === 'low' ? 4000 : level === 'medium' ? 8000 : 16000 } } };
    case 'gemini':
      return { google: { thinkingConfig: { thinkingBudget: level === 'low' ? 4096 : level === 'medium' ? 8192 : 16384 } } };
    default:
      return { vrykell: { reasoning_effort: level } };
  }
}
