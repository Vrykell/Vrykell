import { test, expect } from '@playwright/test';
import { setupTauriMock, ptyWrites, openedPaths } from './tauri-mock';

test('unsupported remote files open as downloaded copies in the system application', async ({ page }) => {
  await setupTauriMock(page, { sshHost: 'known' });
  await page.addInitScript(() => {
    (window as unknown as { __SSH_EXTRA_ENTRIES__: unknown[] }).__SSH_EXTRA_ENTRIES__ = [
      { name: 'report.pdf', path: '/home/root/report.pdf', is_dir: false },
    ];
  });
  await page.goto('/'); await page.locator('[data-dock-btn="ssh"]').click();
  await page.getByTestId('ssh-row-ssh-1').dblclick();
  await page.getByRole('button', { name: '断开连接', exact: true }).waitFor();
  await page.locator('[data-dock-btn="files"]').click();
  await page.getByTestId('remote-file-report.pdf').dblclick();
  await expect.poll(() => openedPaths(page)).toEqual(['/tmp/report.pdf']);
  await expect(page.getByText('已打开下载的副本，修改不会同步到远程文件。')).toBeVisible();
  await expect(page.getByTestId('file-editor')).toHaveCount(0);
});

test('remote file double click opens and saves in the embedded editor', async ({ page }) => {
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
  const editor = page.getByTestId('file-editor');
  await expect(editor.locator('.monaco-editor')).toBeVisible();
  await editor.locator('textarea.inputarea').focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('remote saved text');
  await page.keyboard.press('Control+s');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mock-editor-files') ?? '{}')['["ssh-1","/home/root/app.log"]'])).toBe('remote saved text');
  await expect(page.getByTestId('remote-file-tree')).toHaveAttribute('data-path', '/home/root');
  expect(await ptyWrites(page)).not.toContain("vim '/home/root/app.log'\n");
  await expect(page.getByText('SSH 会话未就绪', { exact: true })).toHaveCount(0);
});

test('remote path bar respects the terminal editor preference and preserves the directory', async ({ page }) => {
  await setupTauriMock(page, { sshHost: 'known' });
  await page.addInitScript(() => localStorage.setItem('vrykell-editor-preferences', JSON.stringify({ state: { remoteOpenMode: 'terminal' }, version: 0 })));
  await page.goto('/');
  await page.locator('[data-dock-btn="ssh"]').click();
  await page.getByTestId('ssh-row-ssh-1').dblclick();
  await page.getByRole('button', { name: '断开连接', exact: true }).waitFor();
  await page.locator('[data-dock-btn="files"]').click();
  await page.getByTestId('remote-file-app.log').waitFor();

  // The path bar follows the saved remote editor preference.
  await page.getByTestId('remote-crumb-bar').click();
  const input = page.getByTestId('remote-path-input');
  await input.fill('/home/root/app.log');
  await input.press('Enter');

  await expect.poll(() => ptyWrites(page)).toContain("vim '/home/root/app.log'\n");
  // Opening a file preserves the directory currently displayed in the panel.
  await expect(page.getByTestId('remote-file-tree')).toHaveAttribute('data-path', '/home/root');
});
