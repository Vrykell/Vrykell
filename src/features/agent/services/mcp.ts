/**
 * mcp — Model Context Protocol frontend (types + invoke wrappers + tool wrapping).
 *
 * Mirrors the MCP design used by mainstream coding agents: the backend holds the stdio connections
 * (see src-tauri/src/mcp.rs), and the frontend wraps the tools exposed by connected servers as
 * tools namespaced `mcp__<server>__<tool>`.
 */

import { tool, jsonSchema } from 'ai';
import { invoke } from '@platform/diagnostics';
import { gate, type ToolContext } from '@features/agent/stores/permissions';

/** Server status (returned by the backend mcp_get_servers command). */
export interface McpServer {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  url: string;
  enabled: boolean;
  connected: boolean;
  toolCount: number;
}

/** Configuration for saving (no runtime state). */
export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  url: string;
  enabled: boolean;
}

/** A single tool exposed by a connected server (returned by the backend mcp_list_all_tools command). */
export interface McpExposedTool {
  server: string;
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export const listMcpServers = () => invoke<McpServer[]>('mcp_get_servers');
export const saveMcpServer = (config: McpServerConfig) => invoke<void>('mcp_save_server', { config });
export const removeMcpServer = (name: string) => invoke<void>('mcp_remove_server', { name });
export const toggleMcpServer = (name: string, enabled: boolean) =>
  invoke<void>('mcp_toggle_server', { name, enabled });
export const connectMcp = (name: string) => invoke<void>('mcp_connect', { name });
export const disconnectMcp = (name: string) => invoke<void>('mcp_disconnect', { name });
export const listMcpTools = () => invoke<McpExposedTool[]>('mcp_list_all_tools');
export const callMcpTool = (server: string, tool: string, args: Record<string, unknown>, lease?: string | null) =>
  invoke<unknown>('mcp_call_tool', { server, tool, args, ...(lease === undefined ? {} : { lease }) });

/** Wrap an MCP tool as a model tool (execute forwards to the backend mcp_call_tool command). */
export function buildMcpTool(mcp: McpExposedTool, ctx: ToolContext) {
  const description = `[MCP · ${mcp.server}] ${mcp.description || mcp.name}`;
  return tool({
    description,
    inputSchema: jsonSchema(
      (mcp.inputSchema ?? { type: 'object', properties: {} }) as Parameters<typeof jsonSchema>[0],
    ),
    execute: async (args, { toolCallId }) => {
      const input = { server: mcp.server, tool: mcp.name, args: (args ?? {}) as Record<string, unknown> };
      const g = await gate('mcp', input, toolCallId, ctx, 'mcp_call_tool');
      if (!g.proceed) return g.result;
      try {
        if (ctx.signal?.aborted) return { ok: false, cancelled: true };
        return await callMcpTool(mcp.server, mcp.name, input.args, g.lease ?? null);
      } catch (e) {
        return { ok: false, error: String((e as Error)?.message ?? e) };
      }
    },
  });
}
