/**
 * skill — use_skill 工具：按名加载用户自定义技能的完整提示词。
 *
 * 与 Agent Skills 同款「按需加载」：系统提示词里只有技能清单（名称+描述），
 * 模型判断任务匹配某技能后调用本工具拿完整指令。纯本地读取，无副作用。
 */

import { tool } from 'ai';
import { z } from 'zod';
import { enabledSkills, findSkill } from '../skills';
import { gate, type ToolContext } from '../permissions';

export function buildSkillTool(ctx: ToolContext) {
  return tool({
    description:
      '加载一个可用技能的完整指令。先看系统提示词里的「可用技能」清单，' +
      '当用户任务匹配某个技能时，按名调用本工具获取该技能的详细操作步骤，然后照做。',
    inputSchema: z.object({
      name: z.string().describe('技能名（与系统提示词清单中的名字一致）'),
    }),
    execute: async ({ name }, { toolCallId }) => {
      const g = await gate('use_skill', { name }, toolCallId, ctx);
      if (!g.proceed) return g.result;
      const sk = findSkill(name);
      if (!sk) {
        const list = enabledSkills().map((k) => k.name).join('、');
        return {
          ok: false,
          error: list ? `未找到技能「${name}」，可用技能：${list}` : `未找到技能「${name}」且当前没有已启用技能`,
        };
      }
      return `【技能：${sk.name}】\n${sk.prompt}`;
    },
  });
}
