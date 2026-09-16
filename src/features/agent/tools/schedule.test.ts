/**
 * schedule 工具（create/list/toggle/remove）测试。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
import { buildScheduleTool } from '@features/agent/tools/schedule';
import { usePermissions, type ToolContext } from '@features/agent/stores/permissions';

usePermissions.setState({ levels: { schedule: 'allow' } });
const CTX: ToolContext = {};

beforeEach(() => {
  invokeMock.mockReset();
});

const exec = (args: Record<string, unknown>) =>
  (buildScheduleTool(CTX).schedule as unknown as { execute: (a: unknown, o: unknown) => Promise<unknown> }).execute(args, {});

const S = { id: 's1', name: '巡检', prompt: '检查', intervalMinutes: 60, enabled: false, lastRunAt: 0 };

describe('schedule 工具', () => {
  it('create：缺 name/prompt 报错；成功落库', async () => {
    const bad = await exec({ action: 'create', name: 'x' });
    expect(bad).toEqual({ ok: false, error: 'create 需要 name 与 prompt' });
    invokeMock.mockResolvedValueOnce(undefined);
    const r = await exec({ action: 'create', name: '巡检', prompt: '检查', intervalMinutes: 30 });
    expect(invokeMock).toHaveBeenLastCalledWith('save_schedule', expect.objectContaining({ schedule: expect.objectContaining({ name: '巡检', intervalMinutes: 30 }) }));
    expect(r).toEqual({ ok: true, result: '已创建定时任务「巡检」' });
  });

  it('list：格式化列表 / 空列表提示', async () => {
    invokeMock.mockResolvedValueOnce([S]);
    const r = await exec({ action: 'list' });
    expect(r).toContain('巡检');
    expect(r).toContain('每 60 分钟');
    invokeMock.mockResolvedValueOnce([]);
    expect(await exec({ action: 'list' })).toBe('（无定时任务）');
  });

  it('toggle：按名启停；未找到报错', async () => {
    invokeMock.mockResolvedValueOnce([S]);
    invokeMock.mockResolvedValueOnce(undefined);
    const r = await exec({ action: 'toggle', name: '巡检', enabled: true });
    expect(r).toEqual({ ok: true, result: '已启用「巡检」' });
    invokeMock.mockResolvedValueOnce([]);
    const bad = await exec({ action: 'toggle', name: 'nope' });
    expect(bad).toEqual({ ok: false, error: '未找到任务（用 list 查）' });
  });

  it('remove：删除后确认', async () => {
    invokeMock.mockResolvedValueOnce([S]);
    invokeMock.mockResolvedValueOnce(undefined);
    const r = await exec({ action: 'remove', name: '巡检' });
    expect(r).toEqual({ ok: true, result: '已删除「巡检」' });
  });

  it('toggle 按 id 匹配；未知 action / 后端失败 → 结构化错误', async () => {
    invokeMock.mockResolvedValueOnce([S]);
    invokeMock.mockResolvedValueOnce(undefined);
    expect(await exec({ action: 'toggle', id: 's1' })).toEqual({ ok: true, result: '已启用「巡检」' });
    expect(await exec({ action: 'bogus' as never })).toEqual({ ok: false, error: '未知 action' });
    invokeMock.mockRejectedValueOnce(new Error('db down'));
    expect(await exec({ action: 'list' })).toEqual({ ok: false, error: 'db down' });
  });

  it('门控拒绝直接返回', async () => {
    usePermissions.setState({ levels: { schedule: 'deny' } });
    const r = await exec({ action: 'list' });
    expect(r).toBeDefined();
    expect(invokeMock).not.toHaveBeenCalled();
    usePermissions.setState({ levels: { schedule: 'allow' } });
  });
});
