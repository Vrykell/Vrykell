/**
 * agentStream — chat store StreamFn 的 AI SDK 实现。
 *
 * M0 纯文本路径：streamText 无工具，textStream 逐 delta 回调 onChunk。
 * 网络层走 createChatModel 注入的 Rust 代理 fetch（key 不出 Rust）。
 * 工具/审批/多模态在后续里程碑接入（fullStream + stopWhen）。
 */
import { streamText, type ModelMessage } from 'ai';
import { invoke } from '@tauri-apps/api/core';
import type { StreamFn } from '../stores/chat';
import { createChatModel, type ProviderKind } from './provider';

interface AiConfigInfoRust {
  has_key: boolean;
  base_url: string;
  model: string;
  provider: ProviderKind;
  has_anthropic_key: boolean;
  has_gemini_key: boolean;
  has_tavily_key: boolean;
}

function hasKeyFor(info: AiConfigInfoRust): boolean {
  switch (info.provider) {
    case 'anthropic':
      return info.has_anthropic_key;
    case 'gemini':
      return info.has_gemini_key;
    default:
      return info.has_key;
  }
}

/**
 * 把 AI SDK 的错误拆成人话。v7 重试包装器（"Failed after 3 attempts"）会把
 * 底层的 APICallError（statusCode / responseBody / url / cause）整个吞掉，
 * 这里逐层展开：状态码 + 服务端响应体 + cause 链（Rust 代理的拒绝文案也在其中）。
 */
function describeError(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  const seen = new Set<unknown>();
  while (cur != null && !seen.has(cur)) {
    seen.add(cur);
    if (cur instanceof Error) {
      const anyErr = cur as Error & {
        statusCode?: number;
        responseBody?: string;
        url?: string;
      };
      let line = cur.message || cur.name;
      if (typeof anyErr.statusCode === 'number') {
        line += ` [HTTP ${anyErr.statusCode}]`;
      }
      if (anyErr.url) line += ` (${anyErr.url})`;
      // 与上一层重复的消息不再追加
      if (!parts.some((p) => p.includes(line))) parts.push(line);
      if (typeof anyErr.responseBody === 'string' && anyErr.responseBody) {
        const body = anyErr.responseBody.slice(0, 300);
        if (!parts.some((p) => p.includes(body))) parts.push(`服务端响应: ${body}`);
      }
      cur = cur.cause;
    } else {
      const s = String(cur);
      if (!parts.some((p) => p.includes(s))) parts.push(s);
      break;
    }
  }
  return parts.filter(Boolean).join(' → ') || '未知错误';
}

export const agentStream: StreamFn = async (messages, onChunk) => {
  const info = await invoke<AiConfigInfoRust>('get_ai_config');
  if (!hasKeyFor(info)) {
    throw new Error('尚未配置 API Key，请先在设置中填入');
  }
  const model = createChatModel({
    provider: info.provider,
    baseUrl: info.base_url,
    model: info.model,
  });
  // AI SDK v7 的流不 reject：错误走 onError 回调，textStream 静默结束。
  // 这里捕获后重抛，维持 chat store「catch → 显示出错了」的旧行为。
  let streamError: unknown = null;
  const result = streamText({
    model,
    messages: messages as ModelMessage[],
    onError: ({ error }) => {
      streamError = error;
    },
  });
  for await (const delta of result.textStream) {
    onChunk(delta);
  }
  if (streamError != null) {
    console.error('[agentStream] 流式请求失败:', streamError);
    throw new Error(describeError(streamError));
  }
};
