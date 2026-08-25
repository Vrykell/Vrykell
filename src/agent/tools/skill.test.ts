/**
 * use_skill 工具测试：命中返回完整 prompt，未命中给可用清单（execute 永不 throw）。
 */
import { describe, it, expect } from 'vitest';
import { buildSkillTool } from './skill';
import { useSkills, type Skill } from '../skills';
import { usePermissions, type ToolContext } from '../permissions';

usePermissions.setState({ levels: { use_skill: 'allow' } });
const CTX: ToolContext = {};

type Exec = (args: Record<string, unknown>) => Promise<string | { ok: boolean; error?: string }>;
const execOf = (t: unknown): Exec => {
  const e = (t as { execute: (a: unknown, o: unknown) => Promise<never> }).execute;
  return (args) => e(args, {});
};

describe('use_skill 工具', () => {
  it('命中：返回完整 prompt（带技能名头）', async () => {
    useSkills.setState({
      skills: [{ id: 'a', name: '写单测', description: 'd', prompt: '步骤一…', enabled: true } as Skill],
    });
    const r = await execOf(buildSkillTool(CTX))({ name: '写单测' });
    expect(r).toBe('【技能：写单测】\n步骤一…');
  });

  it('未命中：ok:false + 可用清单', async () => {
    useSkills.setState({
      skills: [
        { id: 'a', name: '写单测', description: 'd', prompt: 'p', enabled: true } as Skill,
        { id: 'b', name: '写文档', description: 'd', prompt: 'p', enabled: true } as Skill,
      ],
    });
    const r = await execOf(buildSkillTool(CTX))({ name: '不存在' });
    expect(r).toEqual({ ok: false, error: '未找到技能「不存在」，可用技能：写单测、写文档' });
  });

  it('无任何技能时未命中给明确提示', async () => {
    useSkills.setState({ skills: [] });
    const r = await execOf(buildSkillTool(CTX))({ name: 'x' });
    expect(r).toEqual({ ok: false, error: '未找到技能「x」且当前没有已启用技能' });
  });
});
