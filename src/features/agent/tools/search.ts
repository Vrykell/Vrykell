/**
 * search — list_dir / search_files 工具（M2）。
 *
 * list_dir 薄封装现有 fs_list；search_files 走新 Rust 命令 fs_search
 * （文件名子串 / 内容逐行两种模式，跳过 .git/node_modules 等重目录，
 *  结果封顶）。execute 永不 throw（约定见 tools/index.ts 头注释）。
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
