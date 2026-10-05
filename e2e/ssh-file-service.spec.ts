import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test('terminal connection does not force the file panel open; unavailable files have a recovery path', async ({ page }) => {
  await setupTauriMock(page, { integration: false });
  await page.addInitScript(() => {
    const ipc = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const invoke = ipc.invoke;
    const fixture = window as unknown as { __FILE_SERVICE_AVAILABLE__?: boolean };
    ipc.invoke = async (command, args) => {
      if (command === 'ssh_list') {
        if (!fixture.__FILE_SERVICE_AVAILABLE__) throw new Error('SFTP_UNAVAILABLE:subsystem request failed');
        return { base: '/home/tester', entries: [{ name: '恢复后的文件.txt', path: '/home/tester/恢复后的文件.txt', is_dir: false }] };
      }
      return invoke(command, args);
    };
  });
  await page.goto('/');
  await page.locator('[data-dock-btn="ssh"]').click();
  await page.getByTestId('ssh-row-ssh-1').dblclick();
  await expect(page.getByTestId('ssh-search')).toBeVisible();
  await expect(page.locator('[data-dock-btn="files"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: '断开连接', exact: true })).toBeEnabled();
  await page.locator('[data-dock-btn="files"]').click();
  await expect(page.getByText('此连接暂不能浏览文件', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '更多操作' })).toHaveCount(0);
  await expect(page.getByText('空目录', { exact: true })).toHaveCount(0);
  await page.evaluate(() => { (window as unknown as { __FILE_SERVICE_AVAILABLE__: boolean }).__FILE_SERVICE_AVAILABLE__ = true; });
  await page.getByRole('button', { name: '重试文件服务' }).click();
  await expect(page.getByText('恢复后的文件.txt')).toBeVisible();
  await page.getByRole('button', { name: '关闭资源面板' }).click();
  await expect(page.getByTestId('ssh-terminal-screen')).toBeVisible();
});

test('file handshake failure is described independently of the terminal connection', async ({ page }) => {
  await setupTauriMock(page, { integration: false });
  await page.addInitScript(() => {
    const ipc = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const invoke = ipc.invoke;
    ipc.invoke = (command, args) => command === 'ssh_list' ? Promise.reject(new Error('SSH 握手失败：[Session(-5)] Unable to exchange encryption keys')) : invoke(command, args);
  });
  await page.goto('/');
  await page.locator('[data-dock-btn="ssh"]').click();
  await page.getByTestId('ssh-row-ssh-1').dblclick();
  await page.locator('[data-dock-btn="files"]').click();
  await expect(page.getByText('此连接暂不能浏览文件', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '继续使用终端' }).click();
  await expect(page.getByTestId('ssh-terminal-screen')).toBeVisible();
  await expect(page.getByText('此连接暂不能浏览文件', { exact: true })).toBeHidden();
});
