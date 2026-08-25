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
import { gate, ensureSkillAccess, type ToolContext } from '../permissions';

/** invoke 结果统一成结构化结果（约定见 tools/index.ts 头注释） */
async function call<T>(fn: () => Promise<T>): Promise<{ ok: boolean; result?: string; error?: string }> {
  try {
    return { ok: true, result: String(await fn()) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function buildFileTools(ctx: ToolContext) {
  return {
    read_file: tool({
      description:
        '读取文本文件内容（默认上限 256KB，超出截断并标记）。' +
        '二进制/非 UTF-8 文件会报错。路径用绝对路径。',
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
      description:
        '整文件写入（会覆盖同名文件；覆盖前自动备份到 ~/.vrykell/backups/）。' +
        '父目录不存在会自动创建。大改动优先用 edit_file 精确替换。',
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
      description:
        '精确字符串替换：old_string 必须在文件中唯一命中，0 处或多处命中都会失败' +
        '（报错含命中数，补充更多上下文使其唯一后重试）。修改已有文件优先用它而不是 write_file。',
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
