import { tool } from 'ai';
import { z } from 'zod';
import { t } from '@i18n';
import { DESC_MEMORY } from '../model/toolTexts';
import { queryMemories, saveMemory } from '../services/platform';
import { gate, type ToolContext } from '../stores/permissions';

export function buildMemoryTool(ctx: ToolContext) {
  return {
    memory: tool({
      description: DESC_MEMORY,
      inputSchema: z.object({
        action: z.enum(['read', 'search', 'append', 'update']),
        query: z.string().max(2048).optional(),
        includeInactive: z.boolean().default(false).describe('Explicit review only: include pending, inactive and expired records. Revalidate before activating.'),
        key: z.string().min(1).max(160).optional().describe('Stable subject key. Reuse the same key when a fact changes.'),
        content: z.string().min(1).max(2048).optional(),
        id: z.string().optional(),
        expectedRevision: z.number().int().positive().optional(),
        scope: z.enum(['project', 'global']).default('project'),
        status: z.enum(['active', 'inactive']).default('active'),
        validDays: z.number().int().min(1).max(365).default(90),
        limit: z.number().int().min(1).max(20).default(10),
        offset: z.number().int().min(0).max(100_000).optional().describe('Offset for explicit paged review'),
      }),
      execute: async (args, { toolCallId }) => {
        if (ctx.signal?.aborted) return { ok: false, cancelled: true };
        const scope = args.scope === 'global' ? 'global' : ctx.memoryScope ?? `conversation:${ctx.tabId ?? 'discussion'}`;
        try {
          if (args.action === 'read' || args.action === 'search') {
            const g = await gate('memory', { action: args.action }, toolCallId, ctx);
            if (!g.proceed) return g.result;
            if (args.action === 'search' && !args.query?.trim()) return { ok: false, error: t('Enter a memory query.') };
            return { ok: true, records: await queryMemories({ scope, query: args.query, limit: args.limit,
              ...(args.offset !== undefined ? { offset: args.offset } : {}), ...(args.includeInactive ? { includeInactive: true } : {}) }) };
          }
          if (!args.key?.trim() || !args.content?.trim() || args.action === 'update' && (!args.id || !args.expectedRevision)) {
            return { ok: false, error: t('Provide a memory key and content; updates also require the current id and revision.') };
          }
          const input = {
            ...(args.action === 'update' ? { id: args.id, expectedRevision: args.expectedRevision } : {}),
            scope, key: args.key, content: args.content, status: args.status,
            source: `conversation:${ctx.tabId ?? 'discussion'}`, expiresAt: Date.now() + args.validDays * 86_400_000,
          };
          const g = await gate('memory', { input, action: args.action }, toolCallId, ctx, 'save_memory');
          if (!g.proceed) return g.result;
          if (ctx.signal?.aborted) return { ok: false, cancelled: true };
          return { ok: true, record: await saveMemory(input, { lease: g.lease ?? null, action: args.action }) };
        } catch (error) {
          return { ok: false, error: String(error instanceof Error ? error.message : error) };
        }
      },
    }),
  };
}
