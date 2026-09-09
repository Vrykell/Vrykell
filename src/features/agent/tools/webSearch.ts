/**
 * webSearch — web_search 工具的 Tavily 兜底实现（M6）。
 *
 * 联网搜索的优先级（agentStream 里组装）：
 *   anthropic → 原生 web_search 工具（provider 服务端执行）
 *   gemini    → 原生 google_search 工具
 *   其余      → 本文件的 Tavily 工具（invoke('tavily_search') 走 Rust 转发，
 *               key 不出 Rust，见 ai.rs 的 tavily_search 命令）
 *
 * execute 返回纯文本结果（ToolRunCard 展开直接可读）；
 * 失败返回 { ok:false, error } 结构化对象（不 throw，让模型自我修正）。
 */

import { invoke } from '@tauri-apps/api/core';
import { tool } from 'ai';
import { z } from 'zod';
import { gate, type ToolContext } from '@/features/agent/services/permissions';
import { DESC_WEB_SEARCH_TAVILY } from '@/features/agent/services/toolTexts';

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}
interface TavilyResponse {
  answer?: string;
  results?: TavilyResult[];
}

/** 单条结果的内容截断长度（避免超长网页摘要灌爆上下文） */
const CONTENT_CAP = 300;

export function buildTavilySearchTool(ctx: ToolContext) {
  return tool({
    description: DESC_WEB_SEARCH_TAVILY,
    inputSchema: z.object({
      query: z.string().describe('搜索词'),
      maxResults: z.number().int().min(1).max(8).optional().describe('结果条数，默认 5'),
    }),
    execute: async ({ query, maxResults }, { toolCallId }) => {
      const g = await gate('web_search', { query }, toolCallId, ctx);
      if (!g.proceed) return g.result;
      try {
        const r = await invoke<TavilyResponse>('tavily_search', {
          query,
          maxResults: maxResults ?? 5,
        });
        return formatResults(r);
      } catch (e) {
        return { ok: false, error: String((e as Error)?.message ?? e) };
      }
    },
  });
}

/** Tavily 响应 → 纯文本（摘要 + 编号结果列表），供模型阅读也供卡片展开 */
export function formatResults(r: TavilyResponse): string {
  const lines = (r.results ?? []).map(
    (it, i) =>
      `${i + 1}. ${it.title ?? ''}\n   ${it.url ?? ''}\n   ${(it.content ?? '').slice(0, CONTENT_CAP)}`,
  );
  const head = r.answer ? `摘要：${r.answer}\n\n` : '';
  return head + (lines.length ? lines.join('\n') : '（无结果）');
}
