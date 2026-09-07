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

import { type ToolSet, tool } from 'ai';
import { z } from 'zod';
import {
  ensureSkillAccess,
  gate,
  levelOf,
  TOOL_NAMES,
  type ToolContext,
} from '@/agent/permissions';
import { buildFileTools } from '@/agent/tools/files';
import { buildMemoryTool } from '@/agent/tools/memory';
import { runCommandAndWait } from '@/agent/tools/runCommand';
import { buildScheduleTool } from '@/agent/tools/schedule';
import { buildSearchTools } from '@/agent/tools/search';
import { buildInstallSkillTool, buildSkillTool } from '@/agent/tools/skill';
import { buildSubagentTool } from '@/agent/tools/subagent';
import { buildTerminalTools } from '@/agent/tools/terminal';
import { DESC_RUN_COMMAND } from '@/agent/toolTexts';

export type { ToolContext } from '@/agent/permissions';

export function buildTools(ctx: ToolContext) {
  const all = {
    run_command: tool({
      description: DESC_RUN_COMMAND,
      inputSchema: z.object({
        command: z.string().describe('要执行的完整 shell 命令（单行）'),
      }),
      execute: async ({ command }, { abortSignal, toolCallId }) => {
        const g = await gate('run_command', { command }, toolCallId, ctx);
        if (!g.proceed) return g.result;
        const t = await ensureSkillAccess(command, toolCallId, ctx);
        if (!t.proceed) return { ok: false, denied: true, error: t.error };
        return runCommandAndWait(command, { signal: abortSignal ?? ctx.signal, toolCallId });
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
    const t = all[name];
    if (t && levelOf(name) !== 'deny') out[name] = t as ToolSet[string];
  }
  return out;
}
