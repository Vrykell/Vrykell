/**
 * subagent 工具（spawn/create/list/remove）测试。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
import { buildSubagentTool } from '@features/agent/tools/subagent';
import { usePermissions, type ToolContext } from '@features/agent/stores/permissions';

usePermissions.setState({ levels: { subagent: 'allow' } });
const CTX: ToolContext = {};

beforeEach(() => {
  invokeMock.mockReset();
});

const exec = (args: Record<string, unknown>) =>
  (buildSubagentTool(CTX).subagent as unknown as { execute: (a: unknown, o: unknown) => Promise<unknown> }).execute(args, {});

describe('subagent 工具', () => {
  it('list：格式化 / 空列表', async () => {
    invokeMock.mockResolvedValueOnce([{ id: 'a', name: '审查', description: '审查代码', prompt: 'p' }]);
    const r = await exec({ action: 'list' });
    expect(r).toContain('审查');
    invokeMock.mockResolvedValueOnce([]);
    expect(await exec({ action: 'list' })).toBe('（无子代理）');
  });

  it('create：缺 name/prompt 报错；成功落库', async () => {
    const bad = await exec({ action: 'create', name: 'x' });
    expect(bad).toEqual({ ok: false, error: 'create 需要 name 与 prompt' });
    invokeMock.mockResolvedValueOnce(undefined);
    const r = await exec({ action: 'create', name: '审查', prompt: '你负责审查' });
    expect(r).toEqual({ ok: true, result: '已创建子代理「审查」' });
  });

  it('remove：按名删除；未找到报错', async () => {
    invokeMock.mockResolvedValueOnce([{ id: 'a', name: '审查', description: '', prompt: 'p' }]);
    invokeMock.mockResolvedValueOnce(undefined);
    const r = await exec({ action: 'remove', agent: '审查' });
    expect(r).toEqual({ ok: true, result: '已删除「审查」' });
    invokeMock.mockResolvedValueOnce([]);
    expect(await exec({ action: 'remove', agent: 'x' })).toEqual({ ok: false, error: '未找到子代理（用 list 查）' });
  });

  it('spawn：缺 agent/task 报错', async () => {
    expect(await exec({ action: 'spawn' })).toEqual({ ok: false, error: 'spawn 需要 agent 与 task' });
    expect(await exec({ action: 'spawn', agent: 'a' })).toEqual({ ok: false, error: 'spawn 需要 agent 与 task' });
  });

  it('spawn：读取定义与配置后执行（生成失败 → 结构化错误，不 throw）', async () => {
    invokeMock.mockResolvedValueOnce({ id: 'a', name: '审查', description: '', prompt: '你是审查员' }); // get_agent
    invokeMock.mockResolvedValueOnce({ provider: 'openai-compatible', base_url: 'http://127.0.0.1:9', model: 'm' }); // get_ai_config
    const r = await exec({ action: 'spawn', agent: '审查', task: '审查这段代码' });
    expect(invokeMock).toHaveBeenCalledWith('get_agent', { nameOrId: '审查' });
    expect(r).toEqual({ ok: false, error: expect.any(String) });
  });

  it('未知 action / 后端失败 → 结构化错误', async () => {
    expect(await exec({ action: 'bogus' as never })).toEqual({ ok: false, error: '未知 action' });
    invokeMock.mockRejectedValueOnce(new Error('db down'));
    expect(await exec({ action: 'list' })).toEqual({ ok: false, error: 'db down' });
    invokeMock.mockRejectedValueOnce(new Error('db down'));
    expect(await exec({ action: 'create', name: 'n', prompt: 'p' })).toEqual({ ok: false, error: 'db down' });
  });

  it('门控拒绝时直接返回门控结果', async () => {
    usePermissions.setState({ levels: { subagent: 'deny' } });
    const r = await exec({ action: 'list' });
    expect(r).toBeDefined();
    expect(invokeMock).not.toHaveBeenCalled();
    usePermissions.setState({ levels: { subagent: 'allow' } });
  });
});
