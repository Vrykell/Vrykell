/**
 * files — read_file / write_file / edit_file tools.
 *
 * Thin wrappers over Rust commands (fs.rs): reads truncate at 256KB, writes back
 * up the previous contents, and edits require a unique match. execute never
 * throws — an invoke Err becomes a structured { ok:false, error } so the model
 * can correct itself.
 */

import { invoke } from '@platform/diagnostics';
import { DESC_READ_FILE, DESC_WRITE_FILE, DESC_EDIT_FILE } from '@features/agent/model/toolTexts';
import { tool } from 'ai';
import { z } from 'zod';
import { gate, ensureSkillAccess, type ToolContext } from '@features/agent/stores/permissions';

/** Normalize invoke results into the structured result shape (see the header comment in tools/index.ts). */
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
      description: DESC_READ_FILE,
      inputSchema: z.object({
        path: z.string().describe('Absolute file path'),
        max_bytes: z.number().int().min(1).max(8 * 1024 * 1024).optional().describe('Maximum bytes to read, default 256KB, limit 8MB'),
      }),
      execute: async ({ path, max_bytes }, { toolCallId }) => {
        const args = { path, maxBytes: max_bytes ?? null };
        const g = await gate('read_file', args, toolCallId, ctx, 'read_file_text');
        if (!g.proceed) return g.result;
        const t = await ensureSkillAccess(path, toolCallId, ctx);
        if (!t.proceed) return { ok: false, denied: true, error: t.error };
        return call(() => invoke<string>('read_file_text', { ...args, lease: g.lease ?? null }));
      },
    }),

    write_file: tool({
      description: DESC_WRITE_FILE,
      inputSchema: z.object({
        path: z.string().describe('Absolute file path'),
        content: z.string().describe('Complete replacement contents'),
      }),
      execute: async ({ path, content }, { toolCallId }) => {
        const args = { path, content };
        const g = await gate('write_file', args, toolCallId, ctx, 'write_file_text');
        if (!g.proceed) return g.result;
        const t = await ensureSkillAccess(path, toolCallId, ctx);
        if (!t.proceed) return { ok: false, denied: true, error: t.error };
        return call(() => invoke<string>('write_file_text', { ...args, lease: g.lease ?? null }));
      },
    }),

    edit_file: tool({
      description: DESC_EDIT_FILE,
      inputSchema: z.object({
        path: z.string().describe('Absolute file path'),
        old_string: z.string().describe('Exact unique original text including whitespace'),
        new_string: z.string().describe('Replacement text'),
      }),
      execute: async ({ path, old_string, new_string }, { toolCallId }) => {
        const args = { path, oldString: old_string, newString: new_string };
        const g = await gate('edit_file', args, toolCallId, ctx, 'edit_file_text');
        if (!g.proceed) return g.result;
        const t = await ensureSkillAccess(path, toolCallId, ctx);
        if (!t.proceed) return { ok: false, denied: true, error: t.error };
        return call(() => invoke<string>('edit_file_text', { ...args, lease: g.lease ?? null }));
      },
    }),
  };
}
