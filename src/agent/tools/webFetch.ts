/**
 * webFetch — 无 key 的联网工具（M6 兜底）。
 *   - web_search：DuckDuckGo HTML 抓取（不依赖 Tavily/原生搜索）。
 *   - web_fetch：抓取任意 URL → 可读文本（webfetch 技能）。
 *
 * 两者都走 Rust 的 web_search / web_fetch 命令（reqwest 直连 + HTML→文本）。
 */

import { tool } from 'ai';
import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import { gate, type ToolContext } from '../permissions';

interface WebResultItem {
  title?: string;
  url?: string;
  content?: string;
}
interface WebSearchResponse {
  results?: WebResultItem[];
}
interface WebFetchResponse {
  title?: string;
  text?: string;
  url?: string;
}

const CONTENT_CAP = 300;
const FETCH_TEXT_CAP = 8000;

function formatSearchResults(r: WebSearchResponse): string {
  const lines = (r.results ?? []).map(
    (it, i) =>
      `${i + 1}. ${it.title ?? ''}\n   ${it.url ?? ''}\n   ${(it.content ?? '').slice(0, CONTENT_CAP)}`,
  );
  return lines.length ? lines.join('\n') : '（无结果）';
}

/** web_search 兜底：DuckDuckGo HTML 抓取（无需 API Key）。 */
export function buildWebSearchTool(ctx: ToolContext) {
  return tool({
    description:
      '联网搜索（DuckDuckGo，无需 API Key）。查询最新资讯、文档、报错信息等。' +
      '返回结果列表（标题/链接/内容节选）。',
    inputSchema: z.object({
      query: z.string().describe('搜索词'),
      maxResults: z.number().int().min(1).max(8).optional().describe('结果条数，默认 5'),
    }),
    execute: async ({ query, maxResults }, { toolCallId }) => {
      const g = await gate('web_search', { query }, toolCallId, ctx);
      if (!g.proceed) return g.result;
      try {
        const r = await invoke<WebSearchResponse>('web_search', {
          query,
          maxResults: maxResults ?? 5,
        });
        return formatSearchResults(r);
      } catch (e) {
        return { ok: false, error: String((e as Error)?.message ?? e) };
      }
    },
  });
}

/** web_fetch：抓取任意 URL → 可读文本（webfetch 技能）。 */
export function buildWebFetchTool(ctx: ToolContext) {
  return tool({
    description:
      '抓取一个网页 URL，返回可读文本（标题 + 正文，已剥离 HTML 标签与脚本）。' +
      '用于阅读某篇文档/网页，或对搜索结果里的链接做进一步阅读。',
    inputSchema: z.object({
      url: z.string().describe('要抓取的完整 URL（含 https://）'),
    }),
    execute: async ({ url }, { toolCallId }) => {
      const g = await gate('web_fetch', { url }, toolCallId, ctx);
      if (!g.proceed) return g.result;
      try {
        const r = await invoke<WebFetchResponse>('web_fetch', { url });
        const head = r.title ? `标题：${r.title}\n` : '';
        return `${head}${r.text ?? ''}`.slice(0, FETCH_TEXT_CAP);
      } catch (e) {
        return { ok: false, error: String((e as Error)?.message ?? e) };
      }
    },
  });
}
