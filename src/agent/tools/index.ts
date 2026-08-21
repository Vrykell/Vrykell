/**
 * tools — buildTools(ctx) 按开关组装 agent 工具表。
 *
 * M1 只有 run_command（agentMode 总开关即授权，直执行无审批；
 * approval 视觉已就位，审批逻辑 M3 接）。文件/搜索工具 M2 加入。
 *
 * 工具 execute 约定：返回结构化结果而非 throw（throw 会终止步进），
 * 让模型拿到失败信息后自我修正。
 */

import { tool } from 'ai';
import { z } from 'zod';
import { runCommandAndWait } from './runCommand';

export interface ToolContext {
  signal?: AbortSignal;
}

export function buildTools(ctx: ToolContext) {
  return {
    run_command: tool({
      description:
        '在用户当前聚焦的终端 pane 中执行 shell 命令并等待完成，返回退出码与输出尾部。' +
        '命令会显示在终端的输入块中（用户可见）。' +
        '注意：全屏应用（vim/htop 等 altScreen）下会拒绝执行；' +
        '无命令块信号的旧 shell 退化为输出快照（无法保证命令真正结束）；' +
        '默认 120s 超时返回部分输出。交互式/长驻命令（如 dev server）不要用此工具。',
      inputSchema: z.object({
        command: z.string().describe('要执行的完整 shell 命令（单行）'),
      }),
      execute: async ({ command }, { abortSignal, toolCallId }) =>
        runCommandAndWait(command, { signal: abortSignal ?? ctx.signal, toolCallId }),
    }),
  };
}
