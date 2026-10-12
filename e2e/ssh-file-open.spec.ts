import { test, expect } from '@playwright/test';
import { setupTauriMock, ptyWrites } from './tauri-mock';

test('remote file double click opens the editor in the ready SSH pane', async ({ page }) => {
  await setupTauriMock(page, { sshHost: 'known' });
  await page.goto('/');
  await page.locator('[data-dock-btn="ssh"]').click();
  await page.getByTestId('ssh-row-ssh-1').dblclick();
  await page.getByRole('button', { name: '断开连接', exact: true }).waitFor();
  await page.locator('[data-dock-btn="files"]').click();
  await page.getByTestId('remote-file-app.log').waitFor();
  const state = await page.evaluate(async () => {
    const workspacePath = '/src/features/workspace/stores/workspace.ts';
    const terminalPath = '/src/features/terminal/stores/terminal.ts';
    const { useWorkspaceStore } = await import(workspacePath) as typeof import('../src/features/workspace/stores/workspace');
    const { useTerminalStore } = await import(terminalPath) as typeof import('../src/features/terminal/stores/terminal');
    const activeId = useWorkspaceStore.getState().activeId;
    const terminal = useTerminalStore.getState();
    return { activeId, sessions: terminal.sessions };
  });
  expect(state.sessions[state.activeId]).toBeUndefined();
  expect(state.sessions[`${state.activeId}#0`]).toBeTruthy();
  await page.getByTestId('remote-file-app.log').dblclick();
  await expect.poll(() => ptyWrites(page)).toContain("vim '/home/root/app.log'\n");
  await expect(page.getByText('SSH 会话未就绪', { exact: true })).toHaveCount(0);
});
