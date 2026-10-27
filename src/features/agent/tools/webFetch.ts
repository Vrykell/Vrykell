/**
 * webFetch — first-class web tools (on par with read_file/edit_file, independent of the web-search switch).
 *   - web_search: HTML search-engine scraping (keyless fallback for web search).
 *   - web_fetch: fetch any URL → structured Markdown text (titles/hierarchy/links keep their structure).
 *   - web_crawl: breadth-first crawl from a starting URL (same domain, depth/page limits), structured per page.
 *
 * All go through the backend web_search / web_fetch / web_crawl commands (direct HTTP client + HTML→Markdown).
 */

import { tool } from 'ai';
import { DESC_WEB_SEARCH_DDG, DESC_WEB_FETCH, DESC_WEB_CRAWL } from '@features/agent/model/toolTexts';
import { z } from 'zod';
import { invoke } from '@platform/diagnostics';
import { gate, type ToolContext } from '@features/agent/stores/permissions';

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

/** web_fetch → structured text (title + body + in-page links + truncation marker). */
function formatFetch(r: WebFetchResponse): string {
  const parts: string[] = [];
  if (r.title) parts.push(`标题：${r.title}`);
  if (r.url) parts.push(`来源：${r.url}`);
  const head = parts.length ? parts.join('\n') + '\n\n' : '';
  let body = r.text ?? '';
  if (r.truncated) body += '\n\n[正文已截断]';
  const links = (r.links ?? []).slice(0, FETCH_LINKS_CAP);
  const linkBlock = links.length
    ? '\n\n页内链接：\n' + links.map((l, i) => `${i + 1}. ${l.text ?? ''} ${l.url ?? ''}`).join('\n')
    : '';
  return head + body + linkBlock;
}

/** web_search fallback: HTML search-engine scraping (no API key required). */
export function buildWebSearchTool(ctx: ToolContext) {
  return tool({
      description: DESC_WEB_SEARCH_DDG,
    inputSchema: z.object({
      query: z.string().describe('Search query'),
      maxResults: z.number().int().min(1).max(8).optional().describe('Result limit, default 5'),
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

/** web_fetch: fetch any URL → structured Markdown text (first-class tool). */
export function buildWebFetchTool(ctx: ToolContext) {
  return tool({
      description: DESC_WEB_FETCH,
    inputSchema: z.object({
      url: z.string().describe('Complete HTTP or HTTPS URL'),
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

/** web_crawl: crawl multiple pages (BFS, same domain / depth limit / page limit), structured per page. */
export function buildWebCrawlTool(ctx: ToolContext) {
  return tool({
      description: DESC_WEB_CRAWL,
    inputSchema: z.object({
      start_url: z.string().describe('Starting HTTP or HTTPS URL'),
      max_pages: z.number().int().min(1).max(30).optional().describe('Page limit, default 10'),
      max_depth: z.number().int().min(1).max(4).optional().describe('Depth limit, starting page is depth 0; default 2'),
      same_domain: z.boolean().optional().describe('Restrict links to the same domain, default true'),
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
