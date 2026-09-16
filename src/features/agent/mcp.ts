/**
 * mcp — Model Context Protocol 前端侧（类型 + Tauri invoke 封装 + AI SDK 工具包装）。
 *
 * 参照主流 agent 编码工具的 MCP 设计：Rust 后端持有 stdio 连接（见 src-tauri/src/mcp.rs），
 * 前端把已连接服务器暴露的工具包装成 AI SDK 工具，命名空间为 `mcp__<server>__<tool>`。
 */

import { tool, jsonSchema } from 'ai';
import { invoke } from '@tauri-apps/api/core';
import { gate, type ToolContext } from '@features/agent/permissions';

/** 服务器状态（Rust mcp_get_servers 返回）。 */
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

/** 保存用配置（不含运行时状态）。 */
export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  url: string;
  enabled: boolean;
}

/** 已连接服务器暴露的单个工具（Rust mcp_list_all_tools 返回）。 */
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
export const callMcpTool = (server: string, tool: string, args: Record<string, unknown>) =>
  invoke<unknown>('mcp_call_tool', { server, tool, args });

/** 把一个 MCP 工具包装成 AI SDK 工具（execute 转发到 Rust mcp_call_tool）。 */
export function buildMcpTool(mcp: McpExposedTool, ctx: ToolContext) {
  const description = `[MCP · ${mcp.server}] ${mcp.description || mcp.name}`;
  return tool({
    description,
    inputSchema: jsonSchema(
      (mcp.inputSchema ?? { type: 'object', properties: {} }) as Parameters<typeof jsonSchema>[0],
    ),
    execute: async (args, { toolCallId }) => {
      const g = await gate('mcp', { server: mcp.server, tool: mcp.name }, toolCallId, ctx);
      if (!g.proceed) return g.result;
      try {
        return await callMcpTool(mcp.server, mcp.name, (args ?? {}) as Record<string, unknown>);
      } catch (e) {
        return { ok: false, error: String((e as Error)?.message ?? e) };
      }
    },
  });
}
