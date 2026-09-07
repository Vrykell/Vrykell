/**
 * files — read_file / write_file / edit_file 工具（M2）。
 *
 * 薄封装 Rust 命令（fs.rs）：读取带 256KB 截断、写入前自动备份、
 * 编辑走唯一命中约束。execute 永不 throw —— invoke 的 Err 转为
 * 结构化 { ok:false, error }，让模型自我修正。
 */

import { invoke } from '@tauri-apps/api/core';
import { tool } from 'ai';
import { z } from 'zod';
import { ensureSkillAccess, gate, type ToolContext } from '@/agent/permissions';
import { DESC_EDIT_FILE, DESC_READ_FILE, DESC_WRITE_FILE } from '@/agent/toolTexts';

/** invoke 结果统一成结构化结果（约定见 tools/index.ts 头注释） */
async function call<T>(
  fn: () => Promise<T>,
): Promise<{ ok: boolean; result?: string; error?: string }> {
  try {
    return { ok: true, result: String(await fn()) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function buildFileTools(ctx: ToolContext) {
  return {
    read_file: tool({
      description: DESC_READ_FILE,
      inputSchema: z.object({
        path: z.string().describe('绝对路径'),
        max_bytes: z.number().optional().describe('读取上限字节数，默认 256KB'),
      }),
      execute: async ({ path, max_bytes }, { toolCallId }) => {
        const g = await gate('read_file', { path }, toolCallId, ctx);
        if (!g.proceed) return g.result;
        const t = await ensureSkillAccess(path, toolCallId, ctx);
        if (!t.proceed) return { ok: false, denied: true, error: t.error };
        return call(() => invoke<string>('read_file_text', { path, maxBytes: max_bytes ?? null }));
      },
    }),

    write_file: tool({
      description: DESC_WRITE_FILE,
      inputSchema: z.object({
        path: z.string().describe('绝对路径'),
        content: z.string().describe('完整文件内容'),
      }),
      execute: async ({ path, content }, { toolCallId }) => {
        const g = await gate('write_file', { path }, toolCallId, ctx);
        if (!g.proceed) return g.result;
        const t = await ensureSkillAccess(path, toolCallId, ctx);
        if (!t.proceed) return { ok: false, denied: true, error: t.error };
        return call(() => invoke<string>('write_file_text', { path, content }));
      },
    }),

    edit_file: tool({
      description: DESC_EDIT_FILE,
      inputSchema: z.object({
        path: z.string().describe('绝对路径'),
        old_string: z.string().describe('要被替换的原文（须唯一命中，含缩进/换行）'),
        new_string: z.string().describe('替换后的新内容'),
      }),
      execute: async ({ path, old_string, new_string }, { toolCallId }) => {
        const g = await gate('edit_file', { path }, toolCallId, ctx);
        if (!g.proceed) return g.result;
        const t = await ensureSkillAccess(path, toolCallId, ctx);
        if (!t.proceed) return { ok: false, denied: true, error: t.error };
        return call(() =>
          invoke<string>('edit_file_text', { path, oldString: old_string, newString: new_string }),
        );
      },
    }),
  };
}
