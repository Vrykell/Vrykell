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
        path: z.string().describe('绝对路径'),
      }),
      execute: async ({ path }, { toolCallId }) => {
        const g = await gate('list_dir', { path }, toolCallId, ctx);
        if (!g.proceed) return g.result;
        try {
          const entries = await invoke<FsEntry[]>('fs_list', { path });
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
        root: z.string().describe('搜索根目录（绝对路径）'),
        query: z.string().describe('搜索词（大小写不敏感子串）'),
        content: z.boolean().optional().describe('true=搜文件内容，false=搜文件名（默认）'),
        max_results: z.number().optional().describe('结果上限，默认 100'),
      }),
      execute: async ({ root, query, content, max_results }, { toolCallId }) => {
        const g = await gate('search_files', { root, query }, toolCallId, ctx);
        if (!g.proceed) return g.result;
        try {
          const hits = await invoke<FsSearchHit[]>('fs_search', {
            root,
            query,
            content: content ?? false,
            maxResults: max_results ?? null,
          });
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
