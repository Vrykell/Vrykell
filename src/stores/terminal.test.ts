import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
invokeMock.mockResolvedValue(undefined);
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import {
  getFocusedTerminalId,
  getRecentOutput,
  registerTerminal,
  unregisterTerminal,
  useTerminalStore,
} from '@/stores/terminal';
import { useWorkspaceStore } from '@/stores/workspace';

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
