/**
 * terminal 工具（read_terminal / terminal_keys）测试。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

const { termMock } = vi.hoisted(() => ({
  termMock: {
    state: {
      sessions: {} as Record<string, string>,
      scenes: {} as Record<string, string>,
      dims: {} as Record<string, { cols: number; rows: number }>,
      focusedPaneId: 'p1',
    },
    screen: null as { text?: string } | null,
  },
}));
vi.mock('../../stores/terminal', () => ({
  useTerminalStore: {
    getState: () => termMock.state,
    setState: (p: unknown) => Object.assign(termMock.state, p),
  },
  getFocusedTerminalId: () => termMock.state.focusedPaneId,
  getTerminalScreen: () => termMock.screen,
  termInstances: new Map(),
}));

import { type ToolContext, usePermissions } from '@/features/agent/services/permissions';
import { buildTerminalTools } from '@/features/agent/tools/terminal';
import { useBlockStore } from '@/store/blocks';

usePermissions.setState({ levels: { read_terminal: 'allow', terminal_keys: 'allow' } });
const CTX: ToolContext = {};

type Exec = (args: Record<string, unknown>) => Promise<unknown>;
const execOf = (t: unknown): Exec => {
  const e = (t as { execute: (a: unknown, o: unknown) => Promise<never> }).execute;
  return (args) => e(args, {});
};

beforeEach(() => {
  invokeMock.mockReset();
  termMock.state.sessions = {};
  termMock.state.scenes = {};
  termMock.state.dims = {};
  termMock.state.focusedPaneId = 'p1';
  termMock.screen = null;
  useBlockStore.setState({ byTab: {} });
});

describe('read_terminal 工具', () => {
  it('无会话：结构化错误', async () => {
    const r = await execOf(buildTerminalTools(CTX).read_terminal)({});
    expect(r).toEqual({ ok: false, error: '没有可用的终端会话（请先打开一个终端）' });
  });

  it('主 xterm 有画面：返回画面', async () => {
    termMock.state.sessions = { p1: 's1' };
    termMock.screen = { text: 'vim 画面' };
    const r = (await execOf(buildTerminalTools(CTX).read_terminal)({})) as {
      ok: boolean;
      text?: string;
    };
    expect(r.ok).toBe(true);
    expect(r.text).toBe('vim 画面');
  });

  it('块列表场景：用最近命令块输出拼画面', async () => {
    termMock.state.sessions = { p1: 's1' };
    termMock.state.scenes = { p1: 'blockList' };
    termMock.state.dims = { p1: { cols: 100, rows: 30 } };
    useBlockStore.setState({
      byTab: {
        p1: [{ id: 'b1', command: 'ls', outputText: 'a.txt\nb.txt', status: 'done' } as never],
      },
    });
    const r = (await execOf(buildTerminalTools(CTX).read_terminal)({})) as {
      ok: boolean;
      scene: string;
      cols: number;
      rows: number;
      content: string;
    };
    expect(r.ok).toBe(true);
    expect(r.scene).toBe('blockList');
    expect(r.cols).toBe(100);
    expect(r.rows).toBe(30);
    expect(r.content).toContain('a.txt');
  });

  it('门控拒绝直接返回', async () => {
    usePermissions.setState({ levels: { read_terminal: 'deny' } });
    const r = await execOf(buildTerminalTools(CTX).read_terminal)({});
    expect(r).toBeDefined();
    usePermissions.setState({ levels: { read_terminal: 'allow', terminal_keys: 'allow' } });
  });
});

describe('terminal_keys 工具', () => {
  it('发送按键：\\xNN 归一化、wait_ms 透传、返回场景', async () => {
    termMock.state.sessions = { p1: 's1' };
    termMock.state.scenes = { p1: 'altScreen' };
    invokeMock.mockResolvedValue(undefined);
    const r = (await execOf(buildTerminalTools(CTX).terminal_keys)({
      keys: 'vi a\\x1b',
      wait_ms: 0,
    })) as {
      ok: boolean;
      sent: number;
      scene: string;
      decoded: string;
    };
    expect(invokeMock).toHaveBeenCalledWith('pty_write', { id: 's1', data: 'vi a\u001b' });
    expect(r).toEqual({ ok: true, sent: 5, scene: 'altScreen', decoded: 'vi a\u001b' });
  });

  it('解码模型误写的字面 \\uXXXX（多一层反斜杠），不发纯文本', async () => {
    termMock.state.sessions = { p1: 's1' };
    termMock.state.scenes = { p1: 'altScreen' };
    invokeMock.mockResolvedValue(undefined);
    // 模型写成 {"keys": "\\u000b\\u0018"}：字符串里是字面 "\u000b\u0018" 而非控制字符
    await execOf(buildTerminalTools(CTX).terminal_keys)({ keys: '\\u000b\\u0018', wait_ms: 0 });
    expect(invokeMock).toHaveBeenCalledWith('pty_write', { id: 's1', data: '\u000b\u0018' });
  });

  it('解码全部字面转义形式（\\b \\t \\r \\n \\e \\xNN \\uXXXX）', async () => {
    termMock.state.sessions = { p1: 's1' };
    invokeMock.mockResolvedValue(undefined);
    // 模型把 vim 保存退出写成了双反斜杠字面形式
    await execOf(buildTerminalTools(CTX).terminal_keys)({ keys: 'i\\u001b:wq\\r', wait_ms: 0 });
    expect(invokeMock).toHaveBeenCalledWith('pty_write', { id: 's1', data: 'i\u001b:wq\r' });
    // \\e = Esc、\\b = 退格、\\n = 换行、\\t = Tab、\\x1b = Esc
    await execOf(buildTerminalTools(CTX).terminal_keys)({
      keys: '\\e\\b\\n\\t\\x1b[A',
      wait_ms: 0,
    });
    expect(invokeMock).toHaveBeenCalledWith('pty_write', {
      id: 's1',
      data: '\u001b\b\n\t\u001b[A',
    });
  });

  it('无效转义（如 \\uZZZZ）报错而非原样发送', async () => {
    termMock.state.sessions = { p1: 's1' };
    invokeMock.mockClear();
    const r = (await execOf(buildTerminalTools(CTX).terminal_keys)({
      keys: 'a\\uZZZZ',
      wait_ms: 0,
    })) as {
      ok: boolean;
      error: string;
    };
    expect(r.ok).toBe(false);
    expect(r.error).toContain('无效转义序列');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('空按键 / 超长按键：报错', async () => {
    termMock.state.sessions = { p1: 's1' };
    invokeMock.mockClear();
    const empty = await execOf(buildTerminalTools(CTX).terminal_keys)({ keys: '', wait_ms: 0 });
    expect(empty).toEqual({ ok: false, error: '按键序列为空，请提供要发送的按键' });
    const long = await execOf(buildTerminalTools(CTX).terminal_keys)({
      keys: 'x'.repeat(5000),
      wait_ms: 0,
    });
    expect(long).toEqual({ ok: false, error: '按键序列过长（>4096 字符），请分段发送' });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('无会话 / 写入失败：结构化错误', async () => {
    const noSession = await execOf(buildTerminalTools(CTX).terminal_keys)({
      keys: 'x',
      wait_ms: 0,
    });
    expect(noSession).toEqual({ ok: false, error: '没有可用的终端会话（请先打开一个终端）' });
    termMock.state.sessions = { p1: 's1' };
    invokeMock.mockRejectedValueOnce(new Error('pty 已关闭'));
    const fail = await execOf(buildTerminalTools(CTX).terminal_keys)({ keys: 'x', wait_ms: 0 });
    expect(fail).toEqual({ ok: false, error: '写入终端失败: pty 已关闭' });
  });

  it('门控拒绝直接返回', async () => {
    usePermissions.setState({ levels: { terminal_keys: 'deny' } });
    const r = await execOf(buildTerminalTools(CTX).terminal_keys)({ keys: 'x', wait_ms: 0 });
    expect(r).toBeDefined();
    expect(invokeMock).not.toHaveBeenCalled();
    usePermissions.setState({ levels: { read_terminal: 'allow', terminal_keys: 'allow' } });
  });
});
