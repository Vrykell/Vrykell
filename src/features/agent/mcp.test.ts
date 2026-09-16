/**
 * mcp 前端工具包装测试：buildMcpTool 描述前缀 + execute 转发 mcp_call_tool
 * （成功透传 / 失败结构化，execute 永不 throw）。不测门控。
 */
import { describe, it, expect, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { buildMcpTool, type McpExposedTool } from '@features/agent/mcp';
import { usePermissions, type ToolContext } from '@features/agent/permissions';

usePermissions.setState({ levels: { mcp: 'allow' } });
const CTX: ToolContext = {};

type Exec = (args: Record<string, unknown>) => Promise<unknown>;
const execOf = (t: unknown): Exec => {
  const e = (t as { execute: (a: unknown, o: unknown) => Promise<never> }).execute;
  return (args) => e(args, {});
};

const TOOL: McpExposedTool = {
  server: 'fs',
  name: 'read_file',
  description: '读文件',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
};

describe('buildMcpTool', () => {
  it('描述带 MCP 命名空间前缀；execute 转发 mcp_call_tool', async () => {
    invokeMock.mockResolvedValue('file content');
    const t = buildMcpTool(TOOL, CTX);
    expect((t as { description?: string }).description).toContain('[MCP · fs]');

    const r = await execOf(t)({ path: '/tmp/a.txt' });
    expect(invokeMock).toHaveBeenCalledWith('mcp_call_tool', {
      server: 'fs',
      tool: 'read_file',
      args: { path: '/tmp/a.txt' },
    });
    expect(r).toBe('file content');
  });

  it('invoke 失败 → { ok:false } 不 throw', async () => {
    invokeMock.mockRejectedValue(new Error('MCP 服务器「fs」未连接'));
    const r = await execOf(buildMcpTool(TOOL, CTX))({ path: '/x' });
    expect(r).toEqual({ ok: false, error: 'MCP 服务器「fs」未连接' });
  });
});
