/**
 * terminal 工具（read_terminal / terminal_keys）测试：mock 终端 store 与 pty，
 * 验证结构化结果映射（execute 永不 throw；无会话报错）、块列表回退、按键透传。
 */
import { describe, it, expect, vi } from 'vitest';

const {
  ptyWriteMock,
  getTerminalScreenMock,
  terminalState,
  blockState,
} = vi.hoisted(() => ({
  ptyWriteMock: vi.fn(),
  getTerminalScreenMock: vi.fn(),
  terminalState: {
    sessions: { pane1: 'sid1' } as Record<string, string>,
    scenes: { pane1: 'classic' } as Record<string, 'classic' | 'blockList' | 'altScreen'>,
    dims: { pane1: { cols: 80, rows: 24 } },
  },
  blockState: { byTab: { pane1: [] as Array<{ command: string; outputText: string }> } },
}));

vi.mock('../../lib/pty', () => ({ ptyWrite: ptyWriteMock }));
vi.mock('../../stores/terminal', () => ({
  getFocusedTerminalId: () => 'pane1',
  getTerminalScreen: getTerminalScreenMock,
  useTerminalStore: { getState: () => terminalState },
}));
vi.mock('../../stores/blocks', () => ({
  useBlockStore: { getState: () => blockState },
}));

import { buildTerminalTools } from './terminal';
import { usePermissions, type ToolContext } from '../permissions';

// 本文件测工具逻辑，不测门控（门控见 permissions.test.ts）：两工具都置 allow
usePermissions.setState({
  levels: {
    run_command: 'allow', read_file: 'allow', write_file: 'allow', edit_file: 'allow',
    list_dir: 'allow', search_files: 'allow', web_search: 'allow', web_fetch: 'allow',
    read_terminal: 'allow', terminal_keys: 'allow',
  },
});
const CTX: ToolContext = {};

type Exec = (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
const execOf = (t: unknown): Exec => {
  const e = (t as { execute: (a: unknown, o: unknown) => Promise<never> }).execute;
  return (args) => e(args, {});
};

describe('buildTerminalTools', () => {
  it('read_terminal：altScreen/classic 直接透传画面结构', async () => {
    const screen = {
      scene: 'altScreen',
      cols: 80,
      rows: 24,
      cursorY: 3,
      cursorX: 5,
      content: ' 1|hello\n 2|world',
    };
    getTerminalScreenMock.mockReturnValue(screen);
    const r = await execOf(buildTerminalTools(CTX).read_terminal)({});
    expect(r).toEqual({ ok: true, ...screen });
  });

  it('read_terminal：主 xterm 无实例（blockList）回退命令块输出尾部', async () => {
    getTerminalScreenMock.mockReturnValue(null);
    terminalState.scenes.pane1 = 'blockList';
    blockState.byTab.pane1 = [
      { command: 'ls', outputText: 'a.txt\nb.txt' },
      { command: 'cat b.txt', outputText: 'hello' },
    ];
    const r = await execOf(buildTerminalTools(CTX).read_terminal)({});
    expect(r.ok).toBe(true);
    expect(r.scene).toBe('blockList');
    expect(r.content).toContain('$ ls');
    expect(r.content).toContain('$ cat b.txt');
    expect(r.content).toContain('hello');
    terminalState.scenes.pane1 = 'classic';
  });

  it('read_terminal：无会话时返回 ok:false 不 throw', async () => {
    terminalState.sessions = {} as never;
    const r = await execOf(buildTerminalTools(CTX).read_terminal)({});
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('会话') });
    terminalState.sessions = { pane1: 'sid1' };
  });

  it('terminal_keys：按键透传给聚焦会话的 PTY，返回 sent 长度与场景', async () => {
    ptyWriteMock.mockResolvedValue(undefined);
    const keys = 'ihello\x1b:wq\r';
    const r = await execOf(buildTerminalTools(CTX).terminal_keys)({ keys, wait_ms: 0 });
    expect(ptyWriteMock).toHaveBeenCalledWith('sid1', keys);
    expect(r).toEqual({ ok: true, sent: keys.length, scene: 'classic' });
  });

  it('terminal_keys：容错把误写的 \\xNN 转成控制字符（退格/快捷键可用）', async () => {
    ptyWriteMock.mockResolvedValue(undefined);
    // 模型误写 JSON 不支持的 \x7f（退格）与 \x03（Ctrl+C）：字面量 \xNN 应被转换后发送
    const r = await execOf(buildTerminalTools(CTX).terminal_keys)({ keys: 'helo\\x7f\\x03', wait_ms: 0 });
    expect(ptyWriteMock).toHaveBeenCalledWith('sid1', 'helo\x7f\x03');
    expect(r).toEqual({ ok: true, sent: 6, scene: 'classic' });
  });

  it('terminal_keys：ptyWrite 报错 → ok:false 不 throw', async () => {
    ptyWriteMock.mockRejectedValue(new Error('pty closed'));
    const r = await execOf(buildTerminalTools(CTX).terminal_keys)({ keys: 'x', wait_ms: 0 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('pty closed');
  });
});
