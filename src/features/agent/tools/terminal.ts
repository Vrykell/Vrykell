/**
 * terminal — 实时终端读写工具（read_terminal / terminal_keys）。
 *
 * 让 agent 能像人一样「看屏幕 + 敲键盘」，从而驱动 vim/less/htop 等全屏
 * 交互式 TUI，达到「通过 vim 写文件」的水平：
 *   - read_terminal  读取聚焦终端当前可见画面（altScreen 读 alt buffer，即 vim 画面）
 *   - terminal_keys  向聚焦终端 PTY 发送原始按键序列（不含回车，纯按键）
 *
 * 两者都不等待命令完成（那是 run_command 的职责）；典型用法：
 *   terminal_keys("vi /path/file.txt\r") → read_terminal() → terminal_keys("i…内容…\x1b:wq\r")
 *
 * 约定：永不 throw —— 返回结构化结果，让模型自我修正。
 */

import { tool } from 'ai';
import { t } from '@i18n';
import { DESC_READ_TERMINAL, DESC_TERMINAL_KEYS } from '@features/agent/model/toolTexts';
import { z } from 'zod';
import { ptyWrite } from '@platform/pty';
import {
  getFocusedTerminalId,
  getTerminalScreen,
  useTerminalStore,
  useBlockStore,
} from '@features/terminal';
import { gate, type ToolContext } from '@features/agent/stores/permissions';
import { agentControl } from '../services/agentControl';
import { terminalDisconnected } from '../services/terminalAvailability';

const BLOCK_OUTPUT_CAP = 2000;
const BLOCK_COUNT = 4;

/** 块列表场景下「实时画面」= 最近若干命令块的输出尾部（主 xterm 在该场景闲置）。 */
function blockListContent(paneId: string): string {
  const blocks = useBlockStore.getState().byTab[paneId] ?? [];
  const withOutput = blocks.filter((b) => b.outputText && b.outputText.trim().length > 0);
  const tail = withOutput.slice(-BLOCK_COUNT);
  if (tail.length === 0) return '（块列表为空，暂无输出）';
  return tail
    .map((b) => `$ ${b.command || '（无命令）'}\n${b.outputText.slice(-BLOCK_OUTPUT_CAP)}`)
    .join('\n\n');
}

export function buildTerminalTools(ctx: ToolContext) {
  return {
    read_terminal: tool({
      description: DESC_READ_TERMINAL,
      inputSchema: z.object({}),
      execute: async (_args, { toolCallId }) => {
        const g = await gate('read_terminal', {}, toolCallId, ctx);
        if (!g.proceed) return g.result;
        const paneId = ctx.paneId === undefined ? getFocusedTerminalId() : ctx.paneId;
        if (!paneId) return { ok: false, error: t('No execution terminal is connected to this conversation.') };
        const ts = useTerminalStore.getState();
        const disconnected = terminalDisconnected(paneId);
        if (disconnected) return disconnected;
        const screen = ts.scenes[paneId] === 'blockList' ? null : getTerminalScreen(paneId);
        const executionState = agentControl.isControlled(paneId) || (useBlockStore.getState().byTab[paneId] ?? []).some(block => block.status === 'executing')
          ? 'busy' : ts.scenes[paneId] === 'altScreen' ? 'interactive' : ts.scenes[paneId] === 'blockList' ? 'ready' : 'unknown';
        if (screen) return { ok: true, ...screen, executionState };
        // 主 xterm 无实例（blockList）：用命令块输出拼出「画面」
        return {
          ok: true,
          executionState,
          scene: ts.scenes[paneId] ?? 'classic',
          cols: ts.dims[paneId]?.cols ?? 80,
          rows: ts.dims[paneId]?.rows ?? 24,
          cursorY: null,
          cursorX: null,
          content: blockListContent(paneId),
        };
      },
    }),

    terminal_keys: tool({
      description: DESC_TERMINAL_KEYS,
      inputSchema: z.object({
        keys: z.string().describe('要发送的按键序列；退格=\\b、Ctrl+X=\\u0018、Esc=\\e 或 \\u001b、↑=\\u001b[A，其余控制字符同理用 \\uXXXX 或 \\xNN'),
        wait_ms: z.number().int().min(0).max(3000).optional().describe('发送后等待毫秒让画面更新，默认 300'),
      }),
      execute: async ({ keys, wait_ms }, { toolCallId }) => {
        const g = await gate('terminal_keys', { keys }, toolCallId, ctx);
        if (!g.proceed) return g.result;
        // 容错归一化：模型常把转义多写一层反斜杠（字面文本），全部解码成真实控制字符
        const { keys: normalized, error } = normalizeKeys(keys);
        if (error) {
          return { ok: false, error };
        }
        if (normalized.length === 0 && !wait_ms) {
          return { ok: false, error: '按键序列为空，请提供要发送的按键' };
        }
        if (normalized.length > 4096) {
          return { ok: false, error: '按键序列过长（>4096 字符），请分段发送' };
        }
        const paneId = ctx.paneId === undefined ? getFocusedTerminalId() : ctx.paneId;
        if (!paneId) return { ok: false, error: t('No execution terminal is connected to this conversation.') };
        const sessionId = useTerminalStore.getState().sessions[paneId];
        const disconnected = terminalDisconnected(paneId);
        if (disconnected || !sessionId) return disconnected ?? terminalDisconnected(paneId)!;
        try {
          if (normalized.length > 0) await ptyWrite(sessionId, normalized);
        } catch (e) {
          const disconnected = terminalDisconnected(paneId, sessionId);
          if (disconnected) return disconnected;
          return { ok: false, error: `写入终端失败: ${e instanceof Error ? e.message : String(e)}` };
        }
        const wait = wait_ms ?? 300;
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        const interrupted = terminalDisconnected(paneId, sessionId);
        if (interrupted) return interrupted;
        return {
          ok: true,
          sent: normalized.length,
          decoded: normalized,
          ...(normalized.length === 0 ? { waited_ms: wait } : {}),
          scene: useTerminalStore.getState().scenes[paneId] ?? 'classic',
        };
      },
    }),
  };
}

/**
 * 容错归一化模型写的按键串：把「字面转义」（多一层反斜杠的文本，如 "\\u0018"、"\\b"、"\\e"）
 * 解码成真实控制字符；残留无法识别的转义（如 "\uZZZZ"）返回 error，绝不原样发送。
 */
function normalizeKeys(raw: string): { keys: string; error?: string } {
  const keys = raw
    // 字面 \uXXXX → 字符（如 \\u0018 → Ctrl+X）
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    // 字面 \xNN → 字符（如 \\x1b → Esc）
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    // 字面 \e → Esc
    .replace(/\\e/g, '\u001b')
    // 字面 JSON 转义（模型常多打一层反斜杠）
    .replace(/\\b/g, '\b')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n')
    .replace(/\\f/g, '\f');
  // 校验：此时残留的 \u/\x 一定是格式错误的转义（如 \uZZZZ / \xGG），报错而非原样发送
  const m = /\\u(?![0-9a-fA-F]{4})/.exec(keys) ?? /\\x(?![0-9a-fA-F]{2})/.exec(keys);
  if (m) {
    return {
      keys,
      error:
        `无效转义序列「${m[0]}…」：控制字符请用 \\uXXXX（如 \\u0018）或 \\xNN（如 \\x1b）表达，` +
        '或直接写可见字符；工具不会发送无法识别的转义',
    };
  }
  return { keys };
}
