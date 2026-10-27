/**
 * webSearch — hosted search API fallback for the web_search tool.
 *
 * Web search priority (assembled in agentStream):
 *   anthropic → native web_search tool (the provider runs it server-side)
 *   gemini    → native google_search tool
 *   others    → the hosted search API tool in this file (invoke('tavily_search') is forwarded by
 *               the backend; the key stays there, see the tavily_search command in ai.rs)
 *
 * execute returns plain text (readable when the tool card is expanded);
 * failures return a structured { ok:false, error } object (no throw, so the model can self-correct).
 */

import { tool } from 'ai';
import { DESC_WEB_SEARCH_TAVILY } from '@features/agent/model/toolTexts';
import { z } from 'zod';
import { invoke } from '@platform/diagnostics';
import { gate, type ToolContext } from '@features/agent/stores/permissions';

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}
interface TavilyResponse {
  answer?: string;
  results?: TavilyResult[];
}

/** Content truncation length per result (prevents very long page summaries from flooding the context). */
const CONTENT_CAP = 300;

export function buildTavilySearchTool(ctx: ToolContext) {
  return tool({
      description: DESC_WEB_SEARCH_TAVILY,
    inputSchema: z.object({
      query: z.string().describe('Search query'),
      maxResults: z.number().int().min(1).max(8).optional().describe('Result limit, default 5'),
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

/** Search response → plain text (answer + numbered result list), for both the model and the expanded card. */
export function formatResults(r: TavilyResponse): string {
  const lines = (r.results ?? []).map(
    (it, i) =>
      `${i + 1}. ${it.title ?? ''}\n   ${it.url ?? ''}\n   ${(it.content ?? '').slice(0, CONTENT_CAP)}`,
  );
  const head = r.answer ? `摘要：${r.answer}\n\n` : '';
  return head + (lines.length ? lines.join('\n') : '（无结果）');
}
