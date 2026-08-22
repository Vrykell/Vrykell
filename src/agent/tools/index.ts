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
import { z } from 'zod';
import { runCommandAndWait } from './runCommand';
import { buildFileTools } from './files';
import { buildSearchTools } from './search';
import { gate, levelOf, TOOL_NAMES, type ToolContext, type ToolName } from '../permissions';

export type { ToolContext } from '../permissions';

export function buildTools(ctx: ToolContext) {
  const all = {
    run_command: tool({
      description:
        '在用户当前聚焦的终端 pane 中执行 shell 命令并等待完成，返回退出码与输出尾部。' +
        '命令会显示在终端的输入块中（用户可见）。' +
        '注意：全屏应用（vim/htop 等 altScreen）下会拒绝执行；命令执行中切入全屏界面会立即停止等待；' +
        '无命令块信号的旧 shell 退化为输出快照（无法保证命令真正结束）；' +
        '默认 120s 超时返回部分输出。交互式/长驻命令（如 dev server、TUI 程序）不要用此工具。',
      inputSchema: z.object({
        command: z.string().describe('要执行的完整 shell 命令（单行）'),
      }),
      execute: async ({ command }, { abortSignal, toolCallId }) => {
        const g = await gate('run_command', { command }, toolCallId, ctx);
        if (!g.proceed) return g.result;
        return runCommandAndWait(command, { signal: abortSignal ?? ctx.signal, toolCallId });
      },
    }),
    ...buildFileTools(ctx),
    ...buildSearchTools(ctx),
  } as Record<ToolName, unknown>;
  // deny 级工具不注册（模型根本看不到，比 execute 拒绝更省 token）
  const out: ToolSet = {};
  for (const name of TOOL_NAMES) {
    const t = all[name];
    if (t && levelOf(name) !== 'deny') out[name] = t as ToolSet[string];
  }
  return out;
}
