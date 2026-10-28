/**
 * Skill tool tests: use_skill loads details, install_skill writes to the directory (execute never throws).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { buildSkillTool, buildInstallSkillTool } from '@features/agent/tools/skill';
import { usePermissions, type ToolContext } from '@features/agent/stores/permissions';
import { approvingToolContext } from '../../../test-utils/approvingToolContext';

usePermissions.setState({ levels: { use_skill: 'allow', install_skill: 'allow' } });
const CTX: ToolContext = approvingToolContext();

beforeEach(() => {
  invokeMock.mockReset();
});

type Exec = (args: Record<string, unknown>) => Promise<unknown>;
const execOf = (t: unknown): Exec => {
  const e = (t as { execute: (a: unknown, o: unknown) => Promise<never> }).execute;
  return (args) => e(args, {});
};
describe('use_skill tool', () => {
  it('hit: returns the body + directory + auxiliary file list', async () => {
    invokeMock.mockResolvedValue({
      name: '写单测', description: 'd', prompt: '第一步', dir: '/s/a', files: ['scripts/x.py'],
    });
    const r = await execOf(buildSkillTool(CTX).use_skill)({ name: '写单测' });
    expect(invokeMock).toHaveBeenLastCalledWith('get_skill', { name: '写单测' });
    const s = r as string;
    expect(s).toContain('【技能：写单测】');
    expect(s).toContain('第一步');
    expect(s).toContain('/s/a');
    expect(s).toContain('scripts/x.py');
  });

  it('miss: falls back to listing the available skills', async () => {
    invokeMock.mockRejectedValueOnce(new Error('未找到技能「x」'));
    invokeMock.mockResolvedValueOnce([{ name: '写单测', description: 'd', dir: '/s/a', files: [] }]);
    const r = await execOf(buildSkillTool(CTX).use_skill)({ name: 'x' });
    expect(r).toEqual({ ok: false, error: '未找到技能「x」，可用技能：写单测' });
  });

  it('miss with a failed listing: returns the original error', async () => {
    invokeMock.mockRejectedValueOnce(new Error('原始错误'));
    invokeMock.mockRejectedValueOnce(new Error('列表也挂了'));
    const r = await execOf(buildSkillTool(CTX).use_skill)({ name: 'x' });
    expect(r).toEqual({ ok: false, error: '原始错误' });
  });

  it('permission gate denial returns directly', async () => {
    usePermissions.setState({ levels: { use_skill: 'deny' } });
    const denied = await execOf(buildSkillTool(CTX).use_skill)({ name: 'x' });
    expect(denied).toBeDefined();
    expect(invokeMock).not.toHaveBeenCalled();
    usePermissions.setState({ levels: { use_skill: 'allow', install_skill: 'allow' } });
  });

  it('miss with no available skills: reports that no skills exist', async () => {
    invokeMock.mockRejectedValueOnce(new Error('未找到'));
    invokeMock.mockResolvedValueOnce([]);
    const r = await execOf(buildSkillTool(CTX).use_skill)({ name: 'x' });
    expect(r).toEqual({ ok: false, error: '当前没有任何技能' });
  });
});

describe('install_skill tool', () => {
  it('writes to the skill directory and returns the result', async () => {
    invokeMock.mockResolvedValue({ name: '写 SQL', description: 'd', dir: '/s/x', files: [] });
    const r = await execOf(buildInstallSkillTool(CTX).install_skill)({ name: '写 SQL', description: 'd', prompt: 'p' });
    expect(invokeMock).toHaveBeenLastCalledWith('install_skill_md', { name: '写 SQL', description: 'd', prompt: 'p', lease: 'test-lease' });
    expect(r).toEqual({ ok: true, result: '已安装技能「写 SQL」' });
  });

  it('an empty name errors without writing to disk', async () => {
    invokeMock.mockClear();
    const r = await execOf(buildInstallSkillTool(CTX).install_skill)({ name: '  ', description: '', prompt: '' });
    expect(r).toEqual({ ok: false, error: '技能名不能为空' });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('write failure -> structured error', async () => {
    invokeMock.mockRejectedValueOnce(new Error('磁盘只读'));
    const r = await execOf(buildInstallSkillTool(CTX).install_skill)({ name: 'n', description: 'd', prompt: 'p' });
    expect(r).toEqual({ ok: false, error: '磁盘只读' });
  });
});
