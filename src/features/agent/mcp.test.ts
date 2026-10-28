/**
 * mcp frontend tool wrapper tests: buildMcpTool description prefix + execute forwarding
 * mcp_call_tool (successful pass-through / structured failure, execute never throws). Gating is
 * not covered here.
 */
import { describe, it, expect, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { buildMcpTool, type McpExposedTool } from '@features/agent/services/mcp';
import { usePermissions, type ToolContext } from '@features/agent/stores/permissions';
import { approvingToolContext } from '../../test-utils/approvingToolContext';

usePermissions.setState({ levels: { mcp: 'allow' } });
const CTX: ToolContext = approvingToolContext();

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
  it('preserves server-declared tool failures', async () => {
    const failure = { ok: false, error: 'Permission denied', content: 'Permission denied' };
    invokeMock.mockResolvedValue(failure);
    await expect(execOf(buildMcpTool(TOOL, CTX))({ path: '/x' })).resolves.toEqual(failure);
  });
  it('description carries the MCP namespace prefix; execute forwards to mcp_call_tool', async () => {
    invokeMock.mockResolvedValue('file content');
    const t = buildMcpTool(TOOL, CTX);
    expect((t as { description?: string }).description).toContain('[MCP · fs]');

    const r = await execOf(t)({ path: '/tmp/a.txt' });
    expect(invokeMock).toHaveBeenCalledWith('mcp_call_tool', {
      server: 'fs',
      tool: 'read_file',
      args: { path: '/tmp/a.txt' },
      lease: 'test-lease',
    });
    expect(r).toBe('file content');
  });

  it('invoke failure yields { ok:false } without throwing', async () => {
    invokeMock.mockRejectedValue(new Error('MCP 服务器「fs」未连接'));
    const r = await execOf(buildMcpTool(TOOL, CTX))({ path: '/x' });
    expect(r).toEqual({ ok: false, error: 'MCP 服务器「fs」未连接' });
  });
});
