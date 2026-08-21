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
import { createProxyFetch } from './llmFetch';

export type ProviderKind = 'openai-compatible' | 'anthropic' | 'gemini';

export interface ChatModelConfig {
  provider: ProviderKind;
  baseUrl: string;
  model: string;
}

let proxyFetch: typeof fetch | null = null;

export function createChatModel(cfg: ChatModelConfig) {
  proxyFetch ??= createProxyFetch();
  const fetchImpl = proxyFetch;
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
