import { expect, test } from '@playwright/test';
import { ptyWrites, setupTauriMock } from './tauri-mock';

test('temporary authentication recovers files and resources together without changing the terminal or saved profile', async ({ page }) => {
  await setupTauriMock(page, { integration: false });
  await page.addInitScript(() => {
    const ipc = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const original = ipc.invoke;
    let authenticated = false;
    ipc.invoke = async (command, args) => {
      if (command === 'ssh_authenticate_session') {
        if (args?.password !== 'fixture-server-password') throw new Error('SSH_AUTH_FAILED: Password authentication failed');
        authenticated = true;
        return undefined;
      }
      if (command === 'ssh_forget_session_auth') { authenticated = false; return undefined; }
      if ((command === 'ssh_list' || command === 'ssh_system_status') && !authenticated) {
        throw new Error('SSH_AUTH_FAILED: Private key authentication failed');
      }
      return original(command, args);
    };
  });
  await page.goto('/');
  await page.locator('[data-dock-btn="ssh"]').click();
  await page.getByTestId('ssh-row-ssh-1').dblclick();
  const writes = await ptyWrites(page);
  await page.locator('[data-dock-btn="files"]').click();
  await page.getByRole('button', { name: '认证服务', exact: true }).click();
  const dialog = page.getByTestId('ssh-auth-dialog');
  await expect(page.getByTestId('ssh-session-secret')).toBeFocused();
  await expect(page.getByTestId('ssh-session-secret')).toHaveAttribute('type', 'password');
  await page.setViewportSize({ width: 720, height: 480 });
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(480);
  await page.screenshot({ path: 'test-results/ssh-auth-narrow.png' });
  await page.getByTestId('ssh-session-secret').fill('wrong-fixture-password');
  await dialog.getByRole('button', { name: '认证', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('请检查服务器密码或私钥解密口令后重试');
  await expect(page.getByTestId('ssh-session-secret')).toHaveValue('');
  await page.getByTestId('ssh-session-secret').fill('fixture-server-password');
  await page.getByTestId('ssh-session-secret').press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('app.log', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1240, height: 800 });
  await page.getByTestId('ssh-status-toggle').last().click();
  const status = page.getByTestId('ssh-status-panel');
  await expect(status).toContainText('Linux 6.8');
  await expect(status.getByRole('heading', { name: '连接详情' })).toBeVisible();
  await status.getByRole('button', { name: '清除临时凭据' }).click();
  await expect(page.locator('#app-notifications').getByRole('alert')).toContainText('已保存的 SSH 认证信息被拒绝');
  expect(await ptyWrites(page)).toEqual(writes);
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(storage).not.toContain('fixture-server-password');
  expect(storage).not.toContain('wrong-fixture-password');
});

test('cancelling service authentication keeps the terminal connected', async ({ page }) => {
  await setupTauriMock(page, { integration: false });
  await page.addInitScript(() => { (window as unknown as Record<string, unknown>).__SSH_STATUS_ERROR__ = 'SSH_AUTH_FAILED: Private key authentication failed'; });
  await page.goto('/');
  await page.locator('[data-dock-btn="ssh"]').click();
  await page.getByTestId('ssh-row-ssh-1').dblclick();
  await page.getByTestId('ssh-status-toggle').last().click();
  await page.getByRole('button', { name: '认证服务', exact: true }).click();
  await page.getByTestId('ssh-session-secret').fill('unused-fixture-password');
  await page.getByTestId('ssh-session-secret').press('Escape');
  await expect(page.getByTestId('ssh-auth-dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '断开连接', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '认证服务', exact: true })).toBeFocused();
});
