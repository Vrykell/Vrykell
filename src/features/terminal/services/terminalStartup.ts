import { useTerminalStore } from '../stores/terminal';
import { useWorkspaceStore } from '@features/workspace/stores/workspace';
import { leaves } from '@features/workspace/model/windowLayout';

/** Wait for a live shell prompt, rejecting shutdown and startup failures without polling. */
export function waitForTerminalStartup(paneId: string, timeoutMs = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribeTerminal = () => {};
    let unsubscribeWorkspace = () => {};
    const finish = (sessionId?: string, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      unsubscribeTerminal();
      unsubscribeWorkspace();
      if (sessionId) resolve(sessionId);
      else reject(new Error(error));
    };
    const check = () => {
      const state = useTerminalStore.getState();
      const exists = useWorkspaceStore.getState().tabs.some(tab =>
        tab.kind === 'session' && leaves(tab.layout).some(pane => pane.id === paneId));
      if (!exists || state.startupStates[paneId] === 'closed') finish(undefined, '文件打开已取消：终端已关闭');
      else if (state.startupStates[paneId] === 'failed') finish(undefined, '无法打开文件：终端启动失败');
      else if (state.startupStates[paneId] === 'ready' && state.sessions[paneId]) finish(state.sessions[paneId]);
    };
    const timeout = setTimeout(() => finish(undefined, '终端启动超时，未收到 Shell 就绪响应，请重试'), timeoutMs);
    unsubscribeTerminal = useTerminalStore.subscribe(check);
    unsubscribeWorkspace = useWorkspaceStore.subscribe(check);
    check();
  });
}
