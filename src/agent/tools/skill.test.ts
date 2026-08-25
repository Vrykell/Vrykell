/**
 * 技能工具测试：use_skill 加载详情、install_skill 写入目录（execute 永不 throw）。
 */
import { describe, it, expect, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { buildSkillTool, buildInstallSkillTool } from './skill';
import { usePermissions, type ToolContext } from '../permissions';

usePermissions.setState({ levels: { use_skill: 'allow', install_skill: 'allow' } });
const CTX: ToolContext = {};

type Exec = (args: Record<string, unknown>) => Promise<unknown>;
const execOf = (t: unknown): Exec => {
  const e = (t as { execute: (a: unknown, o: unknown) => Promise<never> }).execute;
  return (args) => e(args, {});
};

describe('use_skill 工具', () => {
  it('命中：返回正文 + 目录 + 辅助文件清单', async () => {
    invokeMock.mockResolvedValue({
      name: '写单测', description: 'd', prompt: '第一步', dir: '/s/a', files: ['scripts/x.py'],
    });
    const r = await execOf(buildSkillTool(CTX))({ name: '写单测' });
    expect(invokeMock).toHaveBeenLastCalledWith('get_skill', { name: '写单测' });
    const s = r as string;
    expect(s).toContain('【技能：写单测】');
    expect(s).toContain('第一步');
    expect(s).toContain('/s/a');
    expect(s).toContain('scripts/x.py');
  });

  it('未命中：回退列出可用技能', async () => {
    invokeMock.mockRejectedValueOnce(new Error('未找到技能「x」'));
    invokeMock.mockResolvedValueOnce([{ name: '写单测', description: 'd', dir: '/s/a', files: [] }]);
    const r = await execOf(buildSkillTool(CTX))({ name: 'x' });
    expect(r).toEqual({ ok: false, error: '未找到技能「x」，可用技能：写单测' });
  });
});

describe('install_skill 工具', () => {
  it('写入技能目录并返回结果', async () => {
    invokeMock.mockResolvedValue({ name: '写 SQL', description: 'd', dir: '/s/x', files: [] });
    const r = await execOf(buildInstallSkillTool(CTX))({ name: '写 SQL', description: 'd', prompt: 'p' });
    expect(invokeMock).toHaveBeenLastCalledWith('install_skill_md', { name: '写 SQL', description: 'd', prompt: 'p' });
    expect(r).toEqual({ ok: true, result: '已安装技能「写 SQL」' });
  });

  it('空名报错不写盘', async () => {
    invokeMock.mockClear();
    const r = await execOf(buildInstallSkillTool(CTX))({ name: '  ', description: '', prompt: '' });
    expect(r).toEqual({ ok: false, error: '技能名不能为空' });
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
