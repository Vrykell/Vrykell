/**
 * webFetch — 一等联网工具（与 read_file/edit_file 同级，不依赖「联网搜索」开关）。
 *   - web_search：DuckDuckGo HTML 抓取（联网搜索无 key 兜底）。
 *   - web_fetch：抓取任意 URL → 结构化 Markdown 文本（标题/层级/链接保留结构）。
 *   - web_crawl：从起始 URL 广度优先爬取多页（同域、限深度/页数），逐页结构化。
 *
 * 都走 Rust 的 web_search / web_fetch / web_crawl 命令（reqwest 直连 + HTML→Markdown）。
 */

import { invoke } from '@tauri-apps/api/core';
import { tool } from 'ai';
import { z } from 'zod';
import { gate, type ToolContext } from '@/features/agent/services/permissions';
import {
  DESC_WEB_CRAWL,
  DESC_WEB_FETCH,
  DESC_WEB_SEARCH_DDG,
} from '@/features/agent/services/toolTexts';

interface WebResultItem {
  title?: string;
  url?: string;
  content?: string;
}
interface WebSearchResponse {
  results?: WebResultItem[];
}

interface WebLink {
  text?: string;
  url?: string;
}
interface WebFetchResponse {
  title?: string;
  text?: string;
  url?: string;
  content_type?: string;
  headings?: string[];
  links?: WebLink[];
  truncated?: boolean;
}
interface CrawlPage {
  title?: string;
  url?: string;
  text?: string;
  headings?: string[];
}
interface WebCrawlResponse {
  pages?: CrawlPage[];
  truncated?: boolean;
}

const CONTENT_CAP = 300;
const FETCH_LINKS_CAP = 10;
const CRAWL_TEXT_CAP = 8000;

function formatSearchResults(r: WebSearchResponse): string {
  const lines = (r.results ?? []).map(
    (it, i) =>
      `${i + 1}. ${it.title ?? ''}\n   ${it.url ?? ''}\n   ${(it.content ?? '').slice(0, CONTENT_CAP)}`,
  );
  return lines.length ? lines.join('\n') : '（无结果）';
}

/** web_fetch → 结构化文本（标题 + 正文 + 页内链接 + 截断标记）。 */
function formatFetch(r: WebFetchResponse): string {
  const parts: string[] = [];
  if (r.title) parts.push(`标题：${r.title}`);
  if (r.url) parts.push(`来源：${r.url}`);
  const head = parts.length ? parts.join('\n') + '\n\n' : '';
  let body = r.text ?? '';
  if (r.truncated) body += '\n\n[正文已截断]';
  const links = (r.links ?? []).slice(0, FETCH_LINKS_CAP);
  const linkBlock = links.length
    ? '\n\n页内链接：\n' +
      links.map((l, i) => `${i + 1}. ${l.text ?? ''} ${l.url ?? ''}`).join('\n')
    : '';
  return head + body + linkBlock;
}

/** web_search 兜底：DuckDuckGo HTML 抓取（无需 API Key）。 */
export function buildWebSearchTool(ctx: ToolContext) {
  return tool({
    description: DESC_WEB_SEARCH_DDG,
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

/** web_fetch：抓取任意 URL → 结构化 Markdown 文本（一等工具）。 */
export function buildWebFetchTool(ctx: ToolContext) {
  return tool({
    description: DESC_WEB_FETCH,
    inputSchema: z.object({
      url: z.string().describe('要抓取的完整 URL（含 http/https）'),
    }),
    execute: async ({ url }, { toolCallId }) => {
      const g = await gate('web_fetch', { url }, toolCallId, ctx);
      if (!g.proceed) return g.result;
      try {
        const r = await invoke<WebFetchResponse>('web_fetch', { url });
        return formatFetch(r);
      } catch (e) {
        return { ok: false, error: String((e as Error)?.message ?? e) };
      }
    },
  });
}

/** web_crawl：爬取多页（BFS，同域/限深度/限页数），逐页结构化。 */
export function buildWebCrawlTool(ctx: ToolContext) {
  return tool({
    description: DESC_WEB_CRAWL,
    inputSchema: z.object({
      start_url: z.string().describe('起始 URL（含 http/https）'),
      max_pages: z.number().int().min(1).max(30).optional().describe('最多抓取页数，默认 10'),
      max_depth: z.number().int().min(1).max(4).optional().describe('爬取深度（起始页=0），默认 2'),
      same_domain: z.boolean().optional().describe('是否只爬同域链接，默认 true'),
    }),
    execute: async ({ start_url, max_pages, max_depth, same_domain }, { toolCallId }) => {
      const g = await gate('web_crawl', { start_url }, toolCallId, ctx);
      if (!g.proceed) return g.result;
      try {
        const r = await invoke<WebCrawlResponse>('web_crawl', {
          startUrl: start_url,
          maxPages: max_pages ?? null,
          maxDepth: max_depth ?? null,
          sameDomain: same_domain ?? true,
        });
        const pages = r.pages ?? [];
        if (pages.length === 0) return '（未爬取到任何页面）';
        const body = pages
          .map((p, i) => {
            const title = p.title ? `标题：${p.title}\n` : '';
            const url = p.url ? `URL：${p.url}\n` : '';
            const text = (p.text ?? '').slice(0, CRAWL_TEXT_CAP);
            return `[${i + 1}/${pages.length}] ${title}${url}\n${text}`;
          })
          .join('\n\n---\n\n');
        return `${body}${r.truncated ? '\n\n[达到页数上限，结果已截断]' : ''}`;
      } catch (e) {
        return { ok: false, error: String((e as Error)?.message ?? e) };
      }
    },
  });
}
