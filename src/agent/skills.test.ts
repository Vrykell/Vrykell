/**
 * skills 测试：启停/过滤/查找/清单格式化（不用 beforeEach，见 files.test.ts 头注释）。
 */
import { describe, it, expect } from 'vitest';
import { useSkills, enabledSkills, findSkill, buildSkillsContext, type Skill } from './skills';

function reset(list: Skill[] = []) {
  useSkills.setState({ skills: list });
}

const s1: Skill = { id: 'a', name: '写单测', description: '为代码写测试', prompt: 'p1', enabled: true };
const s2: Skill = { id: 'b', name: '代码风格', description: '统一风格', prompt: 'p2', enabled: true };
const disabled: Skill = { id: 'c', name: '停用技能', description: 'x', prompt: 'p3', enabled: false };
const unnamed: Skill = { id: 'd', name: '   ', description: '空名', prompt: 'p4', enabled: true };

describe('useSkills store', () => {
  it('add 追加一条空技能并返回 id', () => {
    reset();
    const id = useSkills.getState().add();
    const skills = useSkills.getState().skills;
    expect(skills).toHaveLength(1);
    expect(skills[0]!.id).toBe(id);
    expect(skills[0]!.enabled).toBe(true);
  });

  it('update/remove/toggle 按 id 生效', () => {
    reset([s1, s2]);
    useSkills.getState().update('a', { prompt: '改过' });
    expect(useSkills.getState().skills[0]!.prompt).toBe('改过');
    useSkills.getState().toggle('b');
    expect(useSkills.getState().skills[1]!.enabled).toBe(false);
    useSkills.getState().remove('a');
    expect(useSkills.getState().skills).toHaveLength(1);
  });
});

describe('enabledSkills / findSkill', () => {
  it('过滤停用与空名技能', () => {
    reset([s1, disabled, unnamed, s2]);
    expect(enabledSkills().map((k) => k.id)).toEqual(['a', 'b']);
  });

  it('按名或 id 查找已启用技能', () => {
    reset([s1, disabled]);
    expect(findSkill('写单测')?.id).toBe('a');
    expect(findSkill(' 写单测 ')?.id).toBe('a');
    expect(findSkill('a')?.id).toBe('a');
    expect(findSkill('停用技能')).toBeUndefined();
  });
});

describe('buildSkillsContext', () => {
  it('无启用技能返回空串', () => {
    reset();
    expect(buildSkillsContext()).toBe('');
  });

  it('仅列名称 + 描述，并提示 use_skill 调用', () => {
    reset([s1, s2]);
    const ctx = buildSkillsContext();
    expect(ctx).toContain('use_skill');
    expect(ctx).toContain('- 写单测：为代码写测试');
    expect(ctx).toContain('- 代码风格：统一风格');
    expect(ctx).not.toContain('p1');
  });
});
