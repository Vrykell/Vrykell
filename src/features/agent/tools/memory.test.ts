/**
 * memory 工具（read/update/append/search）测试。
 */
import { describe, it, expect, vi } from 'vitest';
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
import { buildMemoryTool } from '@features/agent/tools/memory';
import { usePermissions, type ToolContext } from '@features/agent/permissions';

usePermissions.setState({ levels: { memory: 'allow' } });
const CTX: ToolContext = {};
const exec = (args: Record<string, unknown>) =>
  (buildMemoryTool(CTX).memory as unknown as { execute: (a: unknown, o: unknown) => Promise<unknown> }).execute(args, {});

describe('memory 工具', () => {
  it('read：拼持久知识 + 流水', async () => {
    invokeMock.mockResolvedValueOnce('事实').mockResolvedValueOnce('流水1\n流水2');
    const r = await exec({ action: 'read' });
    expect(r).toContain('事实');
    expect(r).toContain('流水2');
  });

  it('update：重写持久知识', async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    const r = await exec({ action: 'update', content: '新知识' });
    expect(invokeMock).toHaveBeenLastCalledWith('set_memory', { content: '新知识' });
    expect(r).toEqual({ ok: true, result: '已重写持久知识' });
  });

  it('append：追加流水；空文本报错', async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await exec({ action: 'append', text: '记一下' });
    expect(invokeMock).toHaveBeenLastCalledWith('append_memory_journal', { text: '记一下' });
    const bad = await exec({ action: 'append' });
    expect(bad).toEqual({ ok: false, error: 'append 需要 text' });
  });

  it('search：关键词命中 + 空关键词取最近', async () => {
    invokeMock
      .mockResolvedValueOnce('FACT A').mockResolvedValueOnce('x\nFACT B\n')
      .mockResolvedValueOnce('FACT A').mockResolvedValueOnce('x\nFACT B\n');
    const r = await exec({ action: 'search', query: 'fact' });
    expect(r).toContain('FACT: FACT A');
    const r2 = await exec({ action: 'search', limit: 5 });
    expect(r2).toContain('FACT B');
  });

  it('invoke 失败 → ok:false 不 throw', async () => {
    invokeMock.mockRejectedValueOnce(new Error('读取失败'));
    const r = await exec({ action: 'read' });
    expect(r).toEqual({ ok: false, error: '读取失败' });
  });
});
