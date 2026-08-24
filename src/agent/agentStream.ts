/**
 * agentStream — chat store StreamFn 的 AI SDK 实现。
 *
 * M1 fullStream 路径：streamText + stepCountIs(8) + run_command 工具。
 * 文本 delta 走 onChunk（chat store 50ms 合批）；工具事件低频直写
 * ctx.handlers.onToolEvent（upsert ToolRun，渲染为 rail 上的节点卡片）。
 * agentMode 关闭时 tools=undefined，行为等价 M0 纯文本路径。
 * 网络层走 createChatModel 注入的 Rust 代理 fetch（key 不出 Rust）。
 */
import { stepCountIs, streamText, type ModelMessage, type ToolSet } from 'ai';
import { invoke } from '@tauri-apps/api/core';
import type { StreamFn } from '../stores/chat';
import { createChatModel, createNativeWebSearchTool, deepThinkProviderOptions, type ProviderKind } from './provider';
import { useAgentSettings } from './agentSettings';
import { attachmentsForModel, supportsVision } from './attachments';
import { buildTools } from './tools';
import { buildTavilySearchTool } from './tools/webSearch';
import { levelOf } from './permissions';

interface AiConfigInfoRust {
  has_key: boolean;
  base_url: string;
  model: string;
  provider: ProviderKind;
  has_anthropic_key: boolean;
  has_gemini_key: boolean;
  has_tavily_key: boolean;
  models: { id: string; name: string; provider: ProviderKind; baseUrl: string; model: string }[];
  active_model: string;
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
  const settings = useAgentSettings.getState().resolve(info.active_model);
  const agentMode = settings.agentMode;
  const emitTool = ctx?.handlers?.onToolEvent;

  // M5 附件：带附件的用户消息展开为多模态 ModelMessage（文本段 + 图片 part），
  // 非视觉模型的图片在 attachmentsForModel 内降级为占位提示文本
  const vision = supportsVision(info.provider, info.model);
  // 上下文裁剪：保留最近 N 条消息（0 = 不裁剪）
  const trimmed = settings.contextMessages > 0 ? messages.slice(-settings.contextMessages) : messages;
  const modelMessages: ModelMessage[] = [];
  for (const m of trimmed) {
    if (m.attachments?.length) {
      const { text, images } = await attachmentsForModel(m.attachments, vision);
      const content = [m.content, text].filter(Boolean).join('\n\n');
      if (images.length > 0) {
        modelMessages.push({
          role: 'user',
          content: [
            ...(content ? [{ type: 'text' as const, text: content }] : []),
            ...images.map((image) => ({ type: 'image' as const, image })),
          ],
        });
      } else {
        modelMessages.push({ role: m.role as 'user' | 'assistant', content });
      }
    } else {
      modelMessages.push(m as ModelMessage);
    }
  }

  // 工具调用账本：tool-result/tool-error 事件重建完整 ToolRun 需要
  // toolName/input/startedAt（result 部分不一定带回 input）
  const calls = new Map<
    string,
    { toolName: string; input: Record<string, unknown>; startedAt: number }
  >();

  // 工具表：M1-M3 的本地工具 + M6 联网搜索。
  // 联网优先级：provider 原生（anthropic web_search / gemini google_search，
  // 服务端执行）→ openai-compatible 用 Tavily 转发兜底。
  // 权限只到「注册/不注册」一级：原生工具无本地 execute，per-call 审批不适用。
  const tools: ToolSet = agentMode
    ? buildTools({
        signal: ctx?.signal,
        tabId: ctx?.tabId,
        // M3 审批状态回写：gate() 在 ask/决定时把 ToolRun 打到
        // approval-pending / running / denied（含危险命令原因）
        setToolState: (toolCallId, state, extra) => {
          const c = calls.get(toolCallId);
          emitTool?.({
            toolCallId,
            toolName: c?.toolName ?? 'unknown',
            input: c?.input ?? {},
            startedAt: c?.startedAt ?? Date.now(),
            state,
            ...(extra?.danger ? { danger: extra.danger } : {}),
          });
        },
      })
    : {};
  if (agentMode && settings.webSearch && levelOf('web_search') !== 'deny') {
    const native = createNativeWebSearchTool(info.provider);
    if (native) {
      tools[native.name] = native.tool;
    } else if (info.has_tavily_key) {
      tools.web_search = buildTavilySearchTool({ signal: ctx?.signal, tabId: ctx?.tabId });
    }
  }
  const hasTools = Object.keys(tools).length > 0;

  // AI SDK v7 的流不 reject：错误走 onError 回调 + fullStream 的 error part，
  // 迭代静默结束。这里捕获后重抛，维持 chat store「catch → 显示出错了」的行为。
  let streamError: unknown = null;
  const result = streamText({
    model,
    messages: modelMessages,
    tools: hasTools ? tools : undefined,
    stopWhen: hasTools ? stepCountIs(Math.max(1, Math.round(settings.maxSteps))) : undefined,
    abortSignal: ctx?.signal,
    // M6 深思考：providerOptions 透传（openai-compatible → reasoning_effort）。
    // anthropic thinking 要求 maxOutputTokens > budgetTokens(8000)。
    providerOptions: settings.deepThink ? deepThinkProviderOptions(info.provider) : undefined,
    maxOutputTokens:
      settings.maxOutputTokens > 0
        ? settings.maxOutputTokens
        : settings.deepThink && info.provider === 'anthropic'
          ? 16000
          : undefined,
    temperature: settings.temperature != null ? settings.temperature : undefined,
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
        // 结构化结果哨兵：denied → 保持灰环（不盖成绿）；ok:false → 红节点
        let state: 'done' | 'error' | 'denied' = 'done';
        let error: string | undefined;
        try {
          const v: unknown = JSON.parse(out);
          if (v && typeof v === 'object') {
            const o = v as { denied?: unknown; ok?: unknown; error?: unknown };
            if (o.denied === true) state = 'denied';
            else if (o.ok === false) {
              state = 'error';
              error = typeof o.error === 'string' ? o.error : undefined;
            }
          }
        } catch {
          /* 非 JSON 输出原样按 done 处理 */
        }
        emitTool?.({
          toolCallId: p.toolCallId,
          toolName: c?.toolName ?? p.toolName ?? 'unknown',
          input: c?.input ?? {},
          state,
          output: out.length > 8192 ? out.slice(0, 8192) : out,
          error,
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
