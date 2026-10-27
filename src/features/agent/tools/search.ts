/**
 * search — list_dir / search_files tools.
 *
 * list_dir wraps the existing fs_list command; search_files uses the fs_search
 * Rust command (name substring or per-line content matching, skipping heavy
 * directories such as .git/node_modules, with capped results). execute never
 * throws (see the header comment in tools/index.ts).
 */

import { invoke } from '@platform/diagnostics';
import { DESC_LIST_DIR, DESC_SEARCH_FILES } from '@features/agent/model/toolTexts';
import { tool } from 'ai';
import { z } from 'zod';
import { gate, type ToolContext } from '@features/agent/stores/permissions';

interface FsEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

interface FsSearchHit {
  path: string;
  line: number | null;
  preview: string;
}

export function buildSearchTools(ctx: ToolContext) {
  return {
    list_dir: tool({
      description: DESC_LIST_DIR,
      inputSchema: z.object({
        path: z.string().describe('Absolute directory path'),
      }),
      execute: async ({ path }, { toolCallId }) => {
        const g = await gate('list_dir', { path }, toolCallId, ctx, 'fs_list');
        if (!g.proceed) return g.result;
        try {
          const entries = await invoke<FsEntry[]>('fs_list', { path, lease: g.lease ?? null });
          return {
            ok: true,
            result: entries.map((e) => `${e.is_dir ? '📁' : '📄'} ${e.name}`).join('\n') || '（空目录）',
          };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
    }),

    search_files: tool({
      description: DESC_SEARCH_FILES,
      inputSchema: z.object({
        root: z.string().describe('Absolute search root'),
        query: z.string().describe('Case-insensitive search substring'),
        content: z.boolean().optional().describe('Search contents when true, otherwise names'),
        max_results: z.number().optional().describe('Result limit, default 100'),
      }),
      execute: async ({ root, query, content, max_results }, { toolCallId }) => {
        const args = { root, query, content: content ?? false, maxResults: max_results ?? null };
        const g = await gate('search_files', args, toolCallId, ctx, 'fs_search');
        if (!g.proceed) return g.result;
        try {
          const hits = await invoke<FsSearchHit[]>('fs_search', { ...args, lease: g.lease ?? null });
          const result =
            hits.length === 0
              ? '（无匹配）'
              : hits
                  .map((h) => (h.line != null ? `${h.path}:${h.line}  ${h.preview}` : h.path))
                  .join('\n');
          return { ok: true, result };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
    }),
  };
}
