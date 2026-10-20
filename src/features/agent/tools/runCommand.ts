/**
 * Execute against the captured terminal target and return structured results.
 * Integrated shells complete through command blocks; classic POSIX shells use
 * private markers parsed by the existing terminal. Quiet output is unconfirmed.
 * Cancellation and timeout stop waiting without terminating the terminal process.
 */

import { writeTerminalCommand } from '@features/terminal/services/commandSubmission';
import { t } from '@i18n';
import { executionPaneSpec } from '../services/executionTarget';
import { diagnostic } from '@platform/diagnostics';
import {
  useTerminalStore,
  useBlockStore,
  getFocusedTerminalId,
  getRecentOutputFor,
  watchShellCommandCompletion,
  type ShellCommandCompletion,
} from '@features/terminal';
import { agentControl } from '@features/agent/services/agentControl';
import { DEFAULT_TOOL_COMMAND_TIMEOUT_MS } from '../model/messageParts';

export interface RunCommandResult {
  ok: boolean;
  /** 块模式才有；快照/错误路径为 undefined */
  exitCode?: number;
  /** 输出尾部（≤8KB） */
  output: string;
  error?: string;
  completed?: boolean;
}

const OUTPUT_CAP = 8192;
const BLOCK_GRACE_MS = 1500;

function tail(s: string): string {
  return s.length > OUTPUT_CAP ? s.slice(-OUTPUT_CAP) : s;
}

export async function runCommandAndWait(
  command: string,
  opts?: { signal?: AbortSignal; timeoutMs?: number; toolCallId?: string; paneId?: string | null },
): Promise<RunCommandResult> {
  const paneId = opts?.paneId === undefined ? getFocusedTerminalId() : opts.paneId;
  if (!paneId) return { ok: false, output: '', error: t('No execution terminal is connected to this conversation.') };
  const ts = useTerminalStore.getState();
  const sessionId = ts.sessions[paneId];
  if (!sessionId) {
    return { ok: false, output: '', error: '没有可用的终端会话（请先打开一个终端）' };
  }
  if (opts?.signal?.aborted) return { ok: false, completed: false, output: '', error: t('Command cancelled before execution.') };
  if (agentControl.isControlled(paneId) || (useBlockStore.getState().byTab[paneId] ?? []).some(block => block.status === 'executing')) {
    return { ok: false, completed: false, output: '', error: t('The terminal is busy. Use read_terminal to inspect it before sending another command.') };
  }
  if (ts.scenes[paneId] === 'altScreen') {
    return {
      ok: false,
      output: '',
      error:
        '终端正在运行全屏应用（altScreen，如 vim/htop）。run_command 只用于非交互命令；' +
        '若需驱动这个全屏程序，请改用 read_terminal（看画面）+ terminal_keys（发按键）。',
    };
  }

  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TOOL_COMMAND_TIMEOUT_MS;
  // 认领基准时刻：写入前的已存在的「pending 提示符块」正是本命令未来的家
  // （提示符绘制时 133;A 就建了块），所以不能用「新块」判认领 —— 用
  // startedAt >= t0（preexec 时刻）才覆盖「旧 pending 块转 executing」路径。
  const t0 = Date.now();

  const pane = executionPaneSpec(paneId);
  const posix = pane?.kind === 'ssh' || ['bash', 'zsh', 'sh'].includes(pane?.shellType ?? '');
  const completion = ts.scenes[paneId] === 'classic' && posix ? watchShellCommandCompletion(paneId) : null;
  agentControl.acquire(paneId);
  diagnostic('agent-command-start', { paneId, completionMode: completion ? 'marker' : 'block' });
  try {
    await writeTerminalCommand(paneId, sessionId, completion ? completion.wrap(command) : command);
    const result = await waitForCompletion(paneId, command, t0, opts?.toolCallId, opts?.signal, timeoutMs, completion);
    diagnostic('agent-command-completion', { paneId, completed: result.completed ?? false, ok: result.ok, exitCode: result.exitCode, outputChars: result.output.length });
    return result;
  } catch (e) {
    return { ok: false, output: '', error: `写入终端失败: ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    completion?.dispose();
    agentControl.release(paneId);
  }
}

function waitForCompletion(
  paneId: string,
  command: string,
  t0: number,
  toolCallId: string | undefined,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  completion: ShellCommandCompletion | null,
): Promise<RunCommandResult> {
  return new Promise((resolve) => {
    let settled = false;
    let unsub: (() => void) | null = null;
    let snapshotTimer: ReturnType<typeof setInterval> | null = null;
    let trackedId: string | null = null;

    let doneGraceTimer: ReturnType<typeof setTimeout> | null = null;
    let unsubCompletion: (() => void) | undefined;

    const finish = (r: RunCommandResult) => {
      if (settled) return;
      settled = true;
      unsub?.();
      unsubScene?.();
      unsubCompletion?.();
      signal?.removeEventListener('abort', onAbort);
      if (snapshotTimer) clearInterval(snapshotTimer);
      if (doneGraceTimer) clearTimeout(doneGraceTimer);
      clearTimeout(graceTimer);
      clearTimeout(timeoutTimer);
      resolve(r);
    };

    /** 执行中途切入全屏 TUI（如模型无视描述跑了 vim/claude）→ 立即收口，
     *  不干等 120s 超时；程序留在终端里交给用户操作 */
    const unsubScene = useTerminalStore.subscribe((s) => {
      if (s.scenes[paneId] === 'altScreen') {
        finish({
          ok: false,
          output: '',
          error:
            '命令切入了全屏交互界面（TUI 模式），run_command 无法读取其输出，已停止等待。' +
            '程序仍在终端中运行。若需继续操作这个全屏程序，请用 read_terminal（看画面）+' +
            'terminal_keys（发按键）驱动它，或用非交互式命令（加 --help/--version 等标志或重定向输出）。',
        });
      }
    });

    /** 从被跟踪块构建结果（读取当下 outputText） */
    const resultFromBlock = (): RunCommandResult | null => {
      if (!trackedId) return null;
      const b = (useBlockStore.getState().byTab[paneId] ?? []).find((x) => x.id === trackedId);
      if (!b || (b.status !== 'done' && b.status !== 'interrupted')) return null;
      return {
        ok: b.status === 'done' && b.exitCode === 0,
        completed: true,
        exitCode: b.exitCode ?? undefined,
        output: tail(b.outputText),
        error:
          b.status === 'interrupted'
            ? '命令被中断'
            : b.exitCode !== 0
              ? `退出码 ${b.exitCode}`
              : undefined,
      };
    };

    const settleIfDone = (): void => {
      if (!trackedId || doneGraceTimer) return;
      if (!resultFromBlock()) return;
      // finishBlock 先推 done 样式、再经 xterm write('') FIFO 回调异步提取输出
      // 快照（sessionController.finishBlock）——此刻 outputText 多半还是 ''。
      // 给快照提取一个宽限再收口，否则模型会拿到空输出误判「目录为空」。
      doneGraceTimer = setTimeout(() => {
        const r = resultFromBlock();
        if (r) finish(r);
      }, 350);
    };

    /** A quiet screen is a snapshot, never evidence of command completion. */
    const startSnapshotMode = () => {
      let last = '';
      let stable = 0;
      snapshotTimer = setInterval(() => {
        const cur = getRecentOutputFor(paneId, 30);
        if (cur === last) {
          stable += 1;
          if (stable >= 2) {
            finish({ ok: false, completed: false, output: tail(cur), error: t('Command completion could not be confirmed. This is a terminal snapshot; use read_terminal and do not queue more commands until the shell is ready.') });
          }
        } else {
          last = cur;
          stable = 0;
        }
      }, 500);
    };

    /** 认领新块：登记 ⚡ 真源 + 记录 toolCall→block 映射（内嵌命令块渲染用）
     *  + 立即补一记 updateBlock 让徽标即时出现 */
    const claim = (blockId: string) => {
      trackedId = blockId;
      agentControl.markBlock(blockId);
      if (toolCallId) agentControl.linkToolCall(toolCallId, blockId);
      useBlockStore.getState().updateBlock(paneId, blockId, { agent: true });
    };

    const tryClaim = (): void => {
      const blocks = useBlockStore.getState().byTab[paneId] ?? [];
      // 命令匹配 + preexec 在写入之后（覆盖「预存在 pending 块转 executing」）。
      // 数组按时间序，find 取最早一个匹配。
      const fresh = blocks.find(
        (b) => b.command.trim() === command.trim() && b.startedAt != null && b.startedAt >= t0,
      );
      if (fresh) claim(fresh.id);
    };

    const graceTimer = setTimeout(() => {
      if (!trackedId) {
        // 自愈：宽限期结束时绕过订阅直扫一次（事件可能因时序错过）
        tryClaim();
        // 兜底：命令比对不上（integration 缺 133;E、command 恒空）时，
        // 认领宽限内最新启动的块 —— 写入后 1.5s 内的新执行块几乎必是我们的
        if (!trackedId) {
          const blocks = useBlockStore.getState().byTab[paneId] ?? [];
          const fallback = blocks.filter((b) => b.startedAt != null && b.startedAt >= t0).pop();
          if (fallback) claim(fallback.id);
        }
        settleIfDone();
        if (!settled && !trackedId && !completion) startSnapshotMode();
      }
    }, BLOCK_GRACE_MS);

    const timeoutTimer = setTimeout(() => {
      const out = getRecentOutputFor(paneId, 30);
      finish({ ok: false, completed: false, output: tail(out), error: t('Command timed out after {{seconds}} seconds. It may still be running; use read_terminal before sending another command.', { seconds: Math.round(timeoutMs / 1000) }) });
    }, timeoutMs);

    const onAbort = () => {
      finish({ ok: false, completed: false, output: tail(getRecentOutputFor(paneId, 30)), error: t('Stopped waiting. The command may still be running in the terminal.') });
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    // 订阅块流：认领新块（打 agent 标记）→ 等终态
    unsub = useBlockStore.subscribe(() => {
      if (!trackedId) tryClaim();
      settleIfDone();
    });
    const settleCompletion = () => {
      const result = completion?.result();
      if (result) finish({ ok: result.exitCode === 0, completed: true, exitCode: result.exitCode, output: tail(result.output),
        ...(result.exitCode !== 0 ? { error: t('Exit code: {{code}}', { code: result.exitCode }) } : {}) });
    };
    unsubCompletion = completion?.subscribe(settleCompletion);
    if (signal?.aborted) onAbort();
    else if (useTerminalStore.getState().scenes[paneId] === 'altScreen') {
      finish({ ok: false, completed: false, output: '', error: t('The command entered an interactive screen. Use read_terminal and terminal_keys to continue.') });
    } else {
      settleCompletion();
      if (!settled) { tryClaim(); settleIfDone(); }
    }
  });
}
