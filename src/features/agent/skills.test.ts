/**
 * skills 前端封装测试：可用技能过滤、清单格式化、invoke 透传。
 */
import { describe, it, expect, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import {
  buildSkillsContext, availableSkillMetas,
  listSkills, getSkill, setSkillState, readSkillFile, removeSkill, installSkillMd,
  importSkillsFromPath, fetchRemoteSkills, type SkillMeta,
} from '@features/agent/services/skills';

const m1: SkillMeta = { name: '写单测', description: '写测试', dir: '/s/a', files: ['scripts/x.py'], hasScripts: true, allowedTools: '', source: '内置', trusted: true, enabled: true, modified: false };
const m2: SkillMeta = { name: '代码审查', description: '审查', dir: '/s/b', files: [], hasScripts: false, allowedTools: '', source: 'AI 安装', trusted: false, enabled: true, modified: true };
const m3: SkillMeta = { name: '停用', description: 'x', dir: '/s/c', files: [], hasScripts: false, allowedTools: '', source: '内置', trusted: true, enabled: false, modified: false };

describe('availableSkillMetas / buildSkillsContext', () => {
  it('只保留已启用且已信任的技能', () => {
    expect(availableSkillMetas([m1, m2, m3]).map((m) => m.name)).toEqual(['写单测']);
  });

  it('清单仅含名称与描述，提示 use_skill', () => {
    const ctx = buildSkillsContext([m1, m2]);
    expect(ctx).toContain('use_skill');
    expect(ctx).toContain('- 写单测: 写测试');
    expect(ctx).toContain('- 代码审查: 审查');
  });
});

describe('invoke 封装', () => {
  it('各命令按约定透传参数', async () => {
    invokeMock.mockResolvedValueOnce([m1]);
    await listSkills();
    expect(invokeMock).toHaveBeenLastCalledWith('list_skills');

    invokeMock.mockResolvedValueOnce({ ...m1, prompt: 'p' });
    await getSkill('写单测');
    expect(invokeMock).toHaveBeenLastCalledWith('get_skill', { name: '写单测' });

    invokeMock.mockResolvedValueOnce(undefined);
    await setSkillState('写单测', true, undefined);
    expect(invokeMock).toHaveBeenLastCalledWith('set_skill_state', { name: '写单测', trusted: true, enabled: null });

    invokeMock.mockResolvedValueOnce('内容');
    await readSkillFile('写单测', 'scripts/x.py');
    expect(invokeMock).toHaveBeenLastCalledWith('read_skill_file', { name: '写单测', relativePath: 'scripts/x.py' });

    invokeMock.mockResolvedValueOnce(undefined);
    await removeSkill('写单测');
    expect(invokeMock).toHaveBeenLastCalledWith('remove_skill', { name: '写单测' });

    invokeMock.mockResolvedValueOnce(m1);
    await installSkillMd('n', 'd', 'p');
    expect(invokeMock).toHaveBeenLastCalledWith('install_skill_md', { name: 'n', description: 'd', prompt: 'p' });

    invokeMock.mockResolvedValueOnce([m1]);
    await importSkillsFromPath('/x');
    expect(invokeMock).toHaveBeenLastCalledWith('import_skills_from_path', { path: '/x' });

    invokeMock.mockResolvedValueOnce([{ name: 'n', description: 'd', prompt: 'p' }]);
    await fetchRemoteSkills('https://x');
    expect(invokeMock).toHaveBeenLastCalledWith('fetch_skill_registry', { url: 'https://x' });
  });
});
