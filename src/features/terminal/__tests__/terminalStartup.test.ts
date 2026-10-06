import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitForTerminalStartup } from '../services/terminalStartup';
import { useTerminalStore } from '../stores/terminal';
import { useWorkspaceStore } from '@features/workspace/stores/workspace';
import { leaf } from '@features/workspace/model/windowLayout';

beforeEach(() => {
  useWorkspaceStore.setState({ tabs: [{ id: 't', kind: 'session', title: 'file', layout: leaf({ id: 'p', kind: 'local' }) }] });
  useTerminalStore.setState({ sessions: {}, startupStates: { p: 'starting' } });
});
afterEach(() => vi.useRealTimers());

describe('terminal command startup', () => {
  it('waits for both shell readiness and a live session', async () => {
    const resolved = vi.fn();
    const ready = waitForTerminalStartup('p').then(resolved);
    useTerminalStore.setState({ sessions: { p: 'session' } });
    await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();
    useTerminalStore.getState().setStartupState('p', 'ready');
    await ready;
    expect(resolved).toHaveBeenCalledExactlyOnceWith('session');
  });
  it('rejects a failed startup without waiting for the timeout', async () => {
    const ready = waitForTerminalStartup('p');
    useTerminalStore.getState().setStartupState('p', 'failed');
    await expect(ready).rejects.toThrow('终端启动失败');
  });
  it('cancels waiting when its terminal tab is closed', async () => {
    const ready = waitForTerminalStartup('p');
    useWorkspaceStore.setState({ tabs: [] });
    await expect(ready).rejects.toThrow('终端已关闭');
  });
  it('times out without retaining a subscription or resolving on later readiness', async () => {
    vi.useFakeTimers();
    const ready = waitForTerminalStartup('p', 200);
    const rejected = expect(ready).rejects.toThrow('未收到 Shell 就绪响应');
    await vi.advanceTimersByTimeAsync(200);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    useTerminalStore.setState({ sessions: { p: 'later' }, startupStates: { p: 'ready' } });
  });
});
