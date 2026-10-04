import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
invokeMock.mockResolvedValue(undefined);
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { useTerminalStore, registerTerminal, unregisterTerminal, getRecentOutput, getFocusedTerminalId } from '@features/terminal/stores/terminal';
import { useWorkspaceStore } from '@features/workspace/stores/workspace';

const initialTerm = useTerminalStore.getState();
const initialWs = useWorkspaceStore.getState();

describe('terminal store', () => {
  beforeEach(() => {
    invokeMock.mockClear();
    useTerminalStore.setState(initialTerm, true);
    useWorkspaceStore.setState(initialWs, true);
    // 模拟启动后存在活跃标签（store 不再内置初始标签）
    useWorkspaceStore.getState().addTab({});
  });

  it('getFocusedTerminalId 默认返回活跃窗口第一个终端', () => {
    const activeId = useWorkspaceStore.getState().activeId;
    expect(getFocusedTerminalId()).toBe(`${activeId}#0`);
  });

  it('clears a stopped session and queued input while retaining its scene and dimensions', () => {
    useTerminalStore.setState({ sessions: { p: 'old', other: 'live' }, pendingCommands: { p: ['secret'], other: ['ls'] }, scenes: { p: 'classic' }, dims: { p: { cols: 80, rows: 24 } } });
    useTerminalStore.getState().clearSession('p', 'old');
    expect(useTerminalStore.getState().sessions).toEqual({ other: 'live' });
    expect(useTerminalStore.getState().pendingCommands).toEqual({ other: ['ls'] });
    expect(useTerminalStore.getState().scenes.p).toBe('classic');
    expect(useTerminalStore.getState().dims.p).toEqual({ cols: 80, rows: 24 });
  });

  it('does not clear a replacement session when an older process exits', () => {
    useTerminalStore.setState({ sessions: { p: 'new' } });
    useTerminalStore.getState().clearSession('p', 'old');
    expect(useTerminalStore.getState().sessions.p).toBe('new');
  });

  it('runInTerminal 写入聚焦终端的会话并补换行', () => {
    const termId = getFocusedTerminalId();
    useTerminalStore.getState().setSession(termId, 's1');
    useTerminalStore.getState().runInTerminal('ls -la');
    expect(invokeMock).toHaveBeenCalledWith('pty_write', { id: 's1', data: 'ls -la\n' });
  });

  it('无会话时自动展开终端面板且不写入', () => {
    invokeMock.mockClear(); // beforeEach 的 addTab 会触发 create_session 记录
    useTerminalStore.setState({ visible: false });
    useTerminalStore.getState().runInTerminal('ls');
    expect(useTerminalStore.getState().visible).toBe(true);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('PTY 尚未就绪时暂存命令，并在会话建立后冲刷', () => {
    const termId = getFocusedTerminalId();
    useTerminalStore.getState().queueCommand(termId, 'echo ready');
    expect(useTerminalStore.getState().pendingCommands[termId]).toEqual(['echo ready']);

    useTerminalStore.getState().setSession(termId, 's1');

    expect(invokeMock).toHaveBeenCalledWith('pty_write', { id: 's1', data: 'echo ready\n' });
    expect(useTerminalStore.getState().pendingCommands[termId]).toBeUndefined();
  });

  it('getRecentOutput 读取聚焦终端的终端缓冲并去尾部空行', () => {
    const termId = getFocusedTerminalId();
    const fakeLines = ['$ ls', 'file1  file2', '', ''];
    const fakeTerm = {
      buffer: {
        active: {
          baseY: 0,
          cursorY: 3,
          getLine: (i: number) => ({ translateToString: () => fakeLines[i] }),
        },
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerTerminal(termId, fakeTerm as any);
    expect(getRecentOutput(10)).toBe('$ ls\nfile1  file2');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    unregisterTerminal(termId, fakeTerm as any);
    expect(getRecentOutput(10)).toBe('');
  });
});
