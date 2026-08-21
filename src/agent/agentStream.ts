/**
 * agentStream — chat store StreamFn 的 AI SDK 实现。
 *
 * M1 fullStream 路径：streamText + stepCountIs(8) + run_command 工具。
 * 文本 delta 走 onChunk（chat store 50ms 合批）；工具事件低频直写
 * ctx.handlers.onToolEvent（upsert ToolRun，渲染为 rail 上的节点卡片）。
 * agentMode 关闭时 tools=undefined，行为等价 M0 纯文本路径。
 * 网络层走 createChatModel 注入的 Rust 代理 fetch（key 不出 Rust）。
 */
import { stepCountIs, streamText, type ModelMessage } from 'ai';
import { invoke } from '@tauri-apps/api/core';
import type { StreamFn } from '../stores/chat';
import { createChatModel, type ProviderKind } from './provider';
import { useAgentSettings } from './agentSettings';
import { buildTools } from './tools';

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
        cause?: unknown;
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
      cur = anyErr.cause;
    } else {
      const s = String(cur);
      if (!parts.some((p) => p.includes(s))) parts.push(s);
      break;
    }
  }
  return parts.filter(Boolean).join(' → ') || '未知错误';
}

export const agentStream: StreamFn = async (messages, onChunk, ctx) => {
  const info = await invoke<AiConfigInfoRust>('get_ai_config');
  if (!hasKeyFor(info)) {
    throw new Error('尚未配置 API Key，请先在设置中填入');
  }
  const model = createChatModel({
    provider: info.provider,
    baseUrl: info.base_url,
    model: info.model,
  });
  const agentMode = useAgentSettings.getState().agentMode;
  const emitTool = ctx?.handlers?.onToolEvent;

  // 工具调用账本：tool-result/tool-error 事件重建完整 ToolRun 需要
  // toolName/input/startedAt（result 部分不一定带回 input）
  const calls = new Map<
    string,
    { toolName: string; input: Record<string, unknown>; startedAt: number }
  >();

  // AI SDK v7 的流不 reject：错误走 onError 回调 + fullStream 的 error part，
  // 迭代静默结束。这里捕获后重抛，维持 chat store「catch → 显示出错了」的行为。
  let streamError: unknown = null;
  const result = streamText({
    model,
    messages: messages as ModelMessage[],
    tools: agentMode ? buildTools({ signal: ctx?.signal }) : undefined,
    stopWhen: agentMode ? stepCountIs(8) : undefined,
    abortSignal: ctx?.signal,
    onError: ({ error }) => {
      streamError = error;
    },
  });
  for await (const part of result.fullStream) {
    switch (part.type) {
      case 'text-delta': {
        // v7 为 part.text；防御性兼容旧的 textDelta 命名
        const t =
          (part as { text?: string }).text ?? (part as { textDelta?: string }).textDelta ?? '';
        if (t) onChunk(t);
        break;
      }
      case 'tool-call': {
        const p = part as {
          toolCallId: string;
          toolName: string;
          input?: unknown;
        };
        const input = (p.input ?? {}) as Record<string, unknown>;
        const startedAt = Date.now();
        calls.set(p.toolCallId, { toolName: p.toolName, input, startedAt });
        emitTool?.({
          toolCallId: p.toolCallId,
          toolName: p.toolName,
          input,
          state: 'running',
          startedAt,
        });
        break;
      }
      case 'tool-result': {
        const p = part as { toolCallId: string; toolName?: string; output?: unknown; result?: unknown };
        const c = calls.get(p.toolCallId);
        const raw = p.output ?? p.result;
        const out = typeof raw === 'string' ? raw : JSON.stringify(raw);
        emitTool?.({
          toolCallId: p.toolCallId,
          toolName: c?.toolName ?? p.toolName ?? 'unknown',
          input: c?.input ?? {},
          state: 'done',
          output: out.length > 8192 ? out.slice(0, 8192) : out,
          startedAt: c?.startedAt ?? Date.now(),
          endedAt: Date.now(),
        });
        break;
      }
      case 'tool-error': {
        const p = part as { toolCallId: string; toolName?: string; error?: unknown };
        const c = calls.get(p.toolCallId);
        emitTool?.({
          toolCallId: p.toolCallId,
          toolName: c?.toolName ?? p.toolName ?? 'unknown',
          input: c?.input ?? {},
          state: 'error',
          error: describeError(p.error),
          startedAt: c?.startedAt ?? Date.now(),
          endedAt: Date.now(),
        });
        break;
      }
      case 'error': {
        streamError = (part as { error?: unknown }).error;
        break;
      }
      default:
        break; // reasoning / step 边界等事件暂不消费
    }
  }
  if (streamError != null) {
    console.error('[agentStream] 流式请求失败:', streamError);
    throw new Error(describeError(streamError));
  }
};
