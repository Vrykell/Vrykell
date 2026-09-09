/**
 * schedule — 定时任务工具：create/list/toggle/remove，让 LLM 自己管理定时任务。
 */
import { tool } from 'ai';
import { z } from 'zod';
import { gate, type ToolContext } from '@/features/agent/services/permissions';
import { listSchedules, removeSchedule, saveSchedule } from '@/features/agent/services/platform';
import { DESC_SCHEDULE } from '@/features/agent/services/toolTexts';

export function buildScheduleTool(ctx: ToolContext) {
  return {
    schedule: tool({
      description: DESC_SCHEDULE,
      inputSchema: z.object({
        action: z.enum(['create', 'list', 'toggle', 'remove']),
        name: z.string().optional().describe('任务名（create/toggle/remove 用）'),
        prompt: z.string().optional().describe('create 时的提示词'),
        intervalMinutes: z
          .number()
          .int()
          .min(1)
          .max(10080)
          .optional()
          .describe('间隔分钟数，默认 60'),
        enabled: z.boolean().optional().describe('toggle 时的目标状态'),
        id: z.string().optional().describe('任务 id（toggle/remove 用，可省，用 name 匹配）'),
      }),
      execute: async (args, { toolCallId }) => {
        const g = await gate('schedule', { action: args.action }, toolCallId, ctx);
        if (!g.proceed) return g.result;
        try {
          switch (args.action) {
            case 'list': {
              const list = await listSchedules();
              if (!list.length) return '（无定时任务）';
              return list
                .map(
                  (s) =>
                    `- ${s.name} | ${s.enabled ? '启用' : '停用'} | 每 ${s.intervalMinutes} 分钟 | ${s.prompt || '（无提示词）'}`,
                )
                .join('\n');
            }
            case 'create': {
              if (!args.name?.trim() || !args.prompt?.trim())
                return { ok: false, error: 'create 需要 name 与 prompt' };
              await saveSchedule({
                id: '',
                name: args.name.trim(),
                prompt: args.prompt,
                intervalMinutes: args.intervalMinutes ?? 60,
                enabled: args.enabled ?? false,
                lastRunAt: 0,
              });
              return { ok: true, result: `已创建定时任务「${args.name.trim()}」` };
            }
            case 'toggle': {
              const list = await listSchedules();
              const s = list.find((x) => x.id === args.id || x.name === args.name);
              if (!s) return { ok: false, error: '未找到任务（用 list 查）' };
              const next = args.enabled ?? !s.enabled;
              await saveSchedule({ ...s, enabled: next });
              return { ok: true, result: `已${next ? '启用' : '停用'}「${s.name}」` };
            }
            case 'remove': {
              const list = await listSchedules();
              const s = list.find((x) => x.id === args.id || x.name === args.name);
              if (!s) return { ok: false, error: '未找到任务（用 list 查）' };
              await removeSchedule(s.id);
              return { ok: true, result: `已删除「${s.name}」` };
            }
            default:
              return { ok: false, error: '未知 action' };
          }
        } catch (e) {
          return { ok: false, error: String((e as Error)?.message ?? e) };
        }
      },
    }),
  };
}
