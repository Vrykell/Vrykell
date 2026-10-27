/**
 * tools — buildTools(ctx) assembles the agent tool table from feature switches
 * and permission levels.
 *
 * Tools with the deny level are never registered. Every other tool calls gate()
 * as its first step (allow and session grants pass straight through, ask suspends
 * on an approval card, and dangerous commands are confirmed on every call
 * regardless of grants).
 *
 * Tool execute convention: return a structured result instead of throwing (a throw
 * ends the step loop); the model receives the failure and can correct itself.
 */

import { tool, type ToolSet } from 'ai';
import { isWindows } from '@platform/runtime';
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
import { gate, levelOf, ensureSkillAccess, TOOL_NAMES, type ToolContext } from '@features/agent/stores/permissions';
import { createCommandQueue } from '../services/commandQueue';
import { buildAskUserTool } from './askUser';

export type { ToolContext } from '@features/agent/stores/permissions';

/**
 * Shell family used for the danger rules.
 *
 * A pane created with the default "system" preference carries no shellType, but on Windows the
 * platform shell is still cmd or PowerShell — leaving it unknown silently disabled every
 * Windows rule (a permanent `Remove-Item -Force` sailed through with no approval reason).
 * SSH panes always run a POSIX shell on the remote host.
 */
export function shellFamilyForPane(
  pane: { kind?: string; shellType?: string | null } | undefined,
  windows: boolean = isWindows,
): string {
  if (pane?.shellType) return pane.shellType;
  if (pane?.kind === 'ssh') return 'posix';
  return windows ? 'powershell' : 'posix';
}

export function buildTools(ctx: ToolContext) {
  // Older callers may omit the environment; the selected pane still determines file access.
  const paneId = ctx.paneId === undefined ? getFocusedTerminalId() : ctx.paneId;
  const pane = executionPaneSpec(paneId);
  const shellType = ctx.shellType ?? shellFamilyForPane(pane);
  ctx = { ...ctx, paneId, remote: ctx.remote || pane?.kind === 'ssh', shellType };
  const queueCommand = createCommandQueue();
  const all = {
    run_command: tool({
      description: DESC_RUN_COMMAND,
      inputSchema: z.object({
        command: z.string().describe('Complete shell command'),
      }),
      execute: (input, { abortSignal, toolCallId }) => queueCommand(async () => {
        const g = await gate('run_command', input, toolCallId, ctx);
        if (!g.proceed) return g.result;
        const command = g.command ?? input.command;
        const t = await ensureSkillAccess(command, toolCallId, ctx);
        if (!t.proceed) return { ok: false, denied: true, error: t.error };
        const result = await runCommandAndWait(command, { signal: abortSignal ?? ctx.signal, toolCallId, paneId: ctx.paneId });
        return g.command === undefined ? result : { ...result, command };
      }, abortSignal ?? ctx.signal),
    }),
    ...buildFileTools(ctx),
    ...buildSearchTools(ctx),
    ...buildTerminalTools(ctx),
    ...buildSkillTool(ctx),
    ...buildInstallSkillTool(ctx),
    ...buildMemoryTool(ctx),
  } as Record<string, unknown>;
  // Deny-level tools are not registered: the model never sees them, which saves tokens compared with rejecting at execute time.
  const out: ToolSet = {};
  for (const name of TOOL_NAMES) {
    if (ctx.paneId === null && ['run_command', 'read_terminal', 'terminal_keys'].includes(name)) continue;
    if (ctx.remote && ['read_file', 'write_file', 'edit_file', 'list_dir', 'search_files'].includes(name)) continue;
    const t = all[name];
    if (t && levelOf(name) !== 'deny') out[name] = t as ToolSet[string];
  }
  if (ctx.tabId && ctx.setToolState) out.ask_user = buildAskUserTool(ctx);
  return out;
}
