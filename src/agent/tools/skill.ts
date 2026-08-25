/**
 * skill — 技能相关工具：
 *   - use_skill：加载一个技能的完整指令（SKILL.md 正文 + 目录 + 辅助文件清单）。
 *   - install_skill：让 agent 替用户安装/更新一个技能（写入 SKILL.md 技能目录）。
 *
 * 技能是磁盘目录（~/.vrykell/skills/<name>/），正文之外还有 scripts/references/assets，
 * agent 拿到技能目录后可用 read_file / run_command 读取运行其中的文件。
 */

import { tool } from 'ai';
import { z } from 'zod';
import { getSkill, listSkills, installSkillMd } from '../skills';
import { gate, type ToolContext } from '../permissions';

export function buildSkillTool(ctx: ToolContext) {
  return {
    use_skill: tool({
      description:
        '加载一个可用技能的完整指令。先看系统提示词里的「可用技能」清单，' +
        '当任务匹配某个技能时按名加载，返回 SKILL.md 正文、技能目录与其中的脚本/参考文件。',
      inputSchema: z.object({
        name: z.string().describe('技能名（与系统提示词清单中的名字一致）'),
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
      description:
        '安装或更新一个技能。当用户要求「添加/做一个…技能」或描述某类可复用操作时，' +
        '把整理好的技能写入：name（唯一名）、description（一句话说明何时用）、' +
        'prompt（完整操作步骤正文）。同名技能会覆盖更新。',
      inputSchema: z.object({
        name: z.string().describe('技能名，唯一'),
        description: z.string().describe('一句话描述何时该用这个技能'),
        prompt: z.string().describe('完整提示词正文，写清步骤'),
      }),
      execute: async ({ name, description, prompt }, { toolCallId }) => {
        const g = await gate('install_skill', { name }, toolCallId, ctx);
        if (!g.proceed) return g.result;
        if (!name.trim()) return { ok: false, error: '技能名不能为空' };
        try {
          const sk = await installSkillMd(name, description, prompt);
          return { ok: true, result: `已安装技能「${sk.name}」` };
        } catch (e) {
          return { ok: false, error: String((e as Error)?.message ?? e) };
        }
      },
    }),
  };
}
