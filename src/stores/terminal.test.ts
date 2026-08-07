import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
invokeMock.mockResolvedValue(undefined);
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { useTerminalStore } from './terminal';

describe('terminal store', () => {
  beforeEach(() => {
    invokeMock.mockClear();
    useTerminalStore.setState({ sessionId: null, visible: true });
  });

  it('runInTerminal 把命令写入活动会话并补换行', () => {
    useTerminalStore.getState().setSession('s1');
    useTerminalStore.getState().runInTerminal('ls -la');
    expect(invokeMock).toHaveBeenCalledWith('pty_write', { id: 's1', data: 'ls -la\n' });
  });

  it('无活动会话时自动展开终端面板且不写入', () => {
    useTerminalStore.setState({ visible: false });
    useTerminalStore.getState().runInTerminal('ls');
    expect(useTerminalStore.getState().visible).toBe(true);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
