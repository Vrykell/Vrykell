/**
 * skill — 技能相关工具：
 *   - use_skill：加载一个技能的完整指令（SKILL.md 正文 + 目录 + 辅助文件清单）。
 *   - install_skill：让 agent 替用户安装/更新一个技能（写入 SKILL.md 技能目录）。
 *
 * 技能是磁盘目录（~/.vrykell/skills/<name>/），正文之外还有 scripts/references/assets，
 * agent 拿到技能目录后可用 read_file / run_command 读取运行其中的文件。
 */

import { tool } from 'ai';
import { DESC_USE_SKILL, DESC_INSTALL_SKILL } from '@features/agent/model/toolTexts';
import { z } from 'zod';
import { getSkill, listSkills, installSkillMd } from '@features/agent/services/skills';
import { gate, type ToolContext } from '@features/agent/stores/permissions';

export function buildSkillTool(ctx: ToolContext) {
  return {
    use_skill: tool({
      description: DESC_USE_SKILL,
      inputSchema: z.object({
        name: z.string().describe('Skill name from the available-skills list'),
      }),
      execute: async ({ name }, { toolCallId }) => {
        const g = await gate('use_skill', { name }, toolCallId, ctx);
        if (!g.proceed) return g.result;
        try {
          const sk = await getSkill(name);
          const files = sk.files.length ? `\n可用文件：${sk.files.join('、')}` : '';
          return (
            `【技能：${sk.name}】\n${sk.prompt}\n\n技能目录：${sk.dir}${files}` +
            '\n按需用 read_file 读取这些文件，或在技能目录下用 run_command 运行 scripts/ 里的脚本。'
          );
        } catch (e) {
          try {
            const metas = await listSkills();
            const list = metas.map((m) => m.name).join('、');
            return {
              ok: false,
              error: list ? `未找到技能「${name}」，可用技能：${list}` : '当前没有任何技能',
            };
          } catch {
            return { ok: false, error: String((e as Error)?.message ?? e) };
          }
        }
      },
    }),
  };
}

/** 让 agent 替用户安装技能（用户说「帮我做个…技能」时用）。 */
export function buildInstallSkillTool(ctx: ToolContext) {
  return {
    install_skill: tool({
      description: DESC_INSTALL_SKILL,
      inputSchema: z.object({
        name: z.string().describe('Unique skill name'),
        description: z.string().describe('One sentence describing when to use this skill'),
        prompt: z.string().describe('Complete instructions with explicit steps'),
      }),
      execute: async ({ name, description, prompt }, { toolCallId }) => {
        const g = await gate('install_skill', { name, description, prompt }, toolCallId, ctx, 'install_skill_md');
        if (!g.proceed) return g.result;
        if (!name.trim()) return { ok: false, error: '技能名不能为空' };
        try {
          const sk = await installSkillMd(name, description, prompt, g.lease ?? null);
          return { ok: true, result: `已安装技能「${sk.name}」` };
        } catch (e) {
          return { ok: false, error: String((e as Error)?.message ?? e) };
        }
      },
    }),
  };
}
