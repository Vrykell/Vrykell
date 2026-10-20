/**
 * tools — buildTools(ctx) 按开关与权限组装 agent 工具表。
 *
 * M1 只有 run_command；M2 加入文件/搜索工具；M3 接权限（permissions.ts）：
 * deny 级工具不注册；其余工具 execute 首行过 gate()（allow/会话授权直放，
 * ask 挂起等审批卡，危险命令无视授权逐次询问）。
 *
 * 工具 execute 约定：返回结构化结果而非 throw（throw 会终止步进），
 * 让模型拿到失败信息后自我修正。
 */

import { tool, type ToolSet } from 'ai';
import { DESC_RUN_COMMAND } from '@features/agent/model/toolTexts';
import { z } from 'zod';
import { executionPaneSpec } from '../services/executionTarget';
import { getFocusedTerminalId } from '@features/terminal';
import { runCommandAndWait } from '@features/agent/tools/runCommand';
import { buildFileTools } from '@features/agent/tools/files';
import { buildSearchTools } from '@features/agent/tools/search';
import { buildTerminalTools } from '@features/agent/tools/terminal';
import { buildSkillTool, buildInstallSkillTool } from '@features/agent/tools/skill';
import { buildMemoryTool } from '@features/agent/tools/memory';
import { buildScheduleTool } from '@features/agent/tools/schedule';
import { buildSubagentTool } from '@features/agent/tools/subagent';
import { gate, levelOf, ensureSkillAccess, TOOL_NAMES, type ToolContext } from '@features/agent/stores/permissions';

export type { ToolContext } from '@features/agent/stores/permissions';

export function buildTools(ctx: ToolContext) {
  // Older callers may omit the environment; the selected pane still determines file access.
  const paneId = ctx.paneId === undefined ? getFocusedTerminalId() : ctx.paneId;
  const pane = executionPaneSpec(paneId);
  ctx = { ...ctx, paneId, remote: ctx.remote || pane?.kind === 'ssh' };
  const all = {
    run_command: tool({
      description: DESC_RUN_COMMAND,
      inputSchema: z.object({
        command: z.string().describe('要执行的完整 shell 命令（单行）'),
      }),
      execute: async (input, { abortSignal, toolCallId }) => {
        const g = await gate('run_command', input, toolCallId, ctx);
        if (!g.proceed) return g.result;
        const command = g.command ?? input.command;
        const t = await ensureSkillAccess(command, toolCallId, ctx);
        if (!t.proceed) return { ok: false, denied: true, error: t.error };
        const result = await runCommandAndWait(command, { signal: abortSignal ?? ctx.signal, toolCallId, paneId: ctx.paneId });
        return g.command === undefined ? result : { ...result, command };
      },
    }),
    ...buildFileTools(ctx),
    ...buildSearchTools(ctx),
    ...buildTerminalTools(ctx),
    ...buildSkillTool(ctx),
    ...buildInstallSkillTool(ctx),
    ...buildMemoryTool(ctx),
    ...buildScheduleTool(ctx),
    ...buildSubagentTool(ctx),
  } as Record<string, unknown>;
  // deny 级工具不注册（模型根本看不到，比 execute 拒绝更省 token）
  const out: ToolSet = {};
  for (const name of TOOL_NAMES) {
    if (ctx.paneId === null && ['run_command', 'read_terminal', 'terminal_keys'].includes(name)) continue;
    if (ctx.remote && ['read_file', 'write_file', 'edit_file', 'list_dir', 'search_files'].includes(name)) continue;
    const t = all[name];
    if (t && levelOf(name) !== 'deny') out[name] = t as ToolSet[string];
  }
  return out;
}
