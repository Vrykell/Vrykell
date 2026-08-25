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
import { z } from 'zod';
import { ptyWrite } from '../../lib/pty';
import {
  getFocusedTerminalId,
  getTerminalScreen,
  useTerminalStore,
} from '../../stores/terminal';
import { useBlockStore } from '../../stores/blocks';
import { gate, type ToolContext } from '../permissions';

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
      description:
        '读取当前聚焦终端的实时可见画面（含 vim/less/htop 等全屏 TUI 的 alt buffer 画面）。' +
        '返回画面文本（带行号）、场景（classic/blockList/altScreen）、尺寸与光标位置。' +
        '用于：查看终端当前状态、阅读 vim 里的文件内容、确认上一次按键后的效果。' +
        '注意：块列表场景返回最近命令块的输出尾部；光标只在 classic/altScreen 有意义。',
      inputSchema: z.object({}),
      execute: async (_args, { toolCallId }) => {
        const g = await gate('read_terminal', {}, toolCallId, ctx);
        if (!g.proceed) return g.result;
        const paneId = getFocusedTerminalId();
        const ts = useTerminalStore.getState();
        if (!ts.sessions[paneId]) {
          return { ok: false, error: '没有可用的终端会话（请先打开一个终端）' };
        }
        const screen = getTerminalScreen(paneId);
        if (screen) return { ok: true, ...screen };
        // 主 xterm 无实例（blockList）：用命令块输出拼出「画面」
        return {
          ok: true,
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
      description:
        '向当前聚焦终端发送原始按键序列（驱动 vim、REPL 等交互程序）。不等待命令完成。' +
        '按键用 JSON 转义表达（合法转义：\\b=退格、\\u0001=Ctrl+A 行首、\\u0003=Ctrl+C、\\u0004=Ctrl+D、' +
        '\\u0005=Ctrl+E 行尾、\\u0015=Ctrl+U 清空输入行、\\u0017=Ctrl+W 删除前一个词、\\u001a=Ctrl+Z、' +
        '\\u001b=Esc、\\u001b[A=↑、\\u001b[B=↓、\\u001b[C=→、\\u001b[D=←、\\r=回车、\\t=Tab）。' +
        '注意：JSON 不支持 \\x 转义，退格必须写 \\b 或 \\u007f，不能用 \\x7f。' +
        '普通可见字符直接写。若输入有误，用 \\b 退格修正（如 "helo\\b" → "hel"）。' +
        '典型：vim 写文件 = terminal_keys("vi 路径\\r") → read_terminal() 看画面 →' +
        ' terminal_keys("i") 进插入模式 → terminal_keys("文件内容") →' +
        ' terminal_keys("\\u001b:wq\\r") 保存退出。发送后可用 read_terminal() 核对效果。',
      inputSchema: z.object({
        keys: z.string().describe('要发送的按键序列；退格=\\b、Ctrl+C=\\u0003、Esc=\\u001b、↑=\\u001b[A，其余控制字符同理用 \\uXXXX'),
        wait_ms: z.number().int().min(0).max(3000).optional().describe('发送后等待毫秒让画面更新，默认 300'),
      }),
      execute: async ({ keys, wait_ms }, { toolCallId }) => {
        const g = await gate('terminal_keys', { keys }, toolCallId, ctx);
        if (!g.proceed) return g.result;
        // 容错：模型可能误写 \xNN（JSON 不支持的转义），转为对应控制字符后再发送
        const normalized = keys.replace(
          /\\x([0-9a-fA-F]{2})/g,
          (_, h: string) => String.fromCharCode(parseInt(h, 16)),
        );
        const paneId = getFocusedTerminalId();
        const sessionId = useTerminalStore.getState().sessions[paneId];
        if (!sessionId) {
          return { ok: false, error: '没有可用的终端会话（请先打开一个终端）' };
        }
        try {
          await ptyWrite(sessionId, normalized);
        } catch (e) {
          return { ok: false, error: `写入终端失败: ${e instanceof Error ? e.message : String(e)}` };
        }
        const wait = wait_ms ?? 300;
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        return { ok: true, sent: normalized.length, scene: useTerminalStore.getState().scenes[paneId] ?? 'classic' };
      },
    }),
  };
}
