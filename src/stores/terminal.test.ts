import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
invokeMock.mockResolvedValue(undefined);
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { useTerminalStore, registerTerminal, unregisterTerminal, getRecentOutput, resolveFocusedPaneId } from './terminal';
import { useWorkspaceStore } from './workspace';

const initialTerm = useTerminalStore.getState();
const initialWs = useWorkspaceStore.getState();

describe('terminal store（按标签隔离）', () => {
  beforeEach(() => {
    invokeMock.mockClear();
    useTerminalStore.setState(initialTerm, true);
    useWorkspaceStore.setState(initialWs, true);
  });

  it('runInTerminal 写入活跃标签的会话并补换行', () => {
    const tabId = useWorkspaceStore.getState().activeId;
    useTerminalStore.getState().setSession(tabId, 's1');
    useTerminalStore.getState().runInTerminal('ls -la');
    expect(invokeMock).toHaveBeenCalledWith('pty_write', { id: 's1', data: 'ls -la\n' });
  });

  it('无会话时自动展开终端面板且不写入', () => {
    useTerminalStore.setState({ visible: false });
    useTerminalStore.getState().runInTerminal('ls');
    expect(useTerminalStore.getState().visible).toBe(true);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('切换标签后写入各自会话', () => {
    const t1 = useWorkspaceStore.getState().activeId;
    useTerminalStore.getState().setSession(t1, 'sess-1');
    useWorkspaceStore.getState().addTab();
    const t2 = useWorkspaceStore.getState().activeId;
    useTerminalStore.getState().setSession(t2, 'sess-2');
    useTerminalStore.getState().runInTerminal('pwd');
    expect(invokeMock).toHaveBeenCalledWith('pty_write', { id: 'sess-2', data: 'pwd\n' });
  });

  it('resolveFocusedPaneId 无聚焦/会话缺失时回落 activeId', () => {
    expect(resolveFocusedPaneId('t1', null, {})).toBe('t1');
    expect(resolveFocusedPaneId('t1', 't1#2', {})).toBe('t1');
    expect(resolveFocusedPaneId('t1', 'other#2', { 'other#2': 's2' })).toBe('t1');
  });

  it('resolveFocusedPaneId 聚焦属于活跃标签且会话存在时返回它', () => {
    expect(resolveFocusedPaneId('t1', 't1#2', { 't1#2': 's2' })).toBe('t1#2');
    expect(resolveFocusedPaneId('t1', 't1', { t1: 's1' })).toBe('t1');
  });

  it('getRecentOutput 读取活跃标签的终端缓冲并去尾部空行', () => {
    const tabId = useWorkspaceStore.getState().activeId;
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
    registerTerminal(tabId, fakeTerm as any);
    expect(getRecentOutput(10)).toBe('$ ls\nfile1  file2');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    unregisterTerminal(tabId, fakeTerm as any);
    expect(getRecentOutput(10)).toBe('');
  });
});
