import { test, expect, type Page } from '@playwright/test';
import { setupTauriMock, emitPtyOutput, ptyWrites } from './tauri-mock';

async function openSsh(page: Page, host: 'known' | 'unknown' | 'changed', confirmed = true) {
  await setupTauriMock(page, { integration: false, sshHost: host, sshTrustConfirmed: confirmed });
  await page.addInitScript(() => localStorage.setItem('vrykell-agent-settings', JSON.stringify({ version: 8, state: { global: { sshOpenMode: 'block' }, overrides: {} } })));
  await page.goto('/');
  await page.locator('[data-dock-btn="ssh"]').click();
  await page.getByTestId('ssh-row-ssh-1').dblclick();
}

async function ipcRecords(page: Page, key: string): Promise<Record<string, unknown>[]> {
  return page.evaluate(name => (window as unknown as Record<string, Record<string, unknown>[]>)[name] ?? [], key);
}

test('first SSH connection confirms its fingerprint and accepts authentication input', async ({ page }) => {
  await openSsh(page, 'unknown');
  const surface = page.getByTestId('ssh-connection-input');
  await expect(surface).toBeVisible();
  await expect(page.getByTestId('ssh-search')).toBeVisible();
  const dialogs = await ipcRecords(page, '__SSH_DIALOGS__');
  expect(dialogs).toHaveLength(1);
  expect(dialogs[0]?.message).toContain('SHA256:e2e-verified-key');
  expect(await ipcRecords(page, '__SSH_TRUSTS__')).toEqual([{ host: 'prod.example.com', port: 22, expectedFingerprint: 'SHA256:e2e-verified-key' }]);
  const sshSpawns = (await ipcRecords(page, '__PTY_SPAWNS__')).filter(s => s.ssh);
  expect(sshSpawns).toHaveLength(1);
  expect(sshSpawns[0]?.ssh).toMatchObject({ hostKeyType: 'ed25519' });
  // 认证输入跟随远端输出：只有服务端真的索要密码时才出现
  await emitPtyOutput(page, '请输入远端密码：');
  await expect(surface.locator('pre')).toContainText('请输入远端密码：');
  const response = surface.getByLabel('SSH 认证响应');
  await expect(response).toBeEnabled();
  await response.fill('test-response');
  await response.press('Enter');
  expect(await ptyWrites(page)).toContain('test-response\r');
  await expect(response).toHaveCount(0);
  // The interactive SSH screen is rendered by xterm so its native cursor follows VT state.
  const xtermHost = surface.getByTestId('ssh-terminal-screen');
  await expect(xtermHost).toBeVisible();
  await expect(xtermHost).toHaveCSS('visibility', 'visible');
  await expect(surface.getByTestId('ssh-screen-cursor')).toHaveCount(0);
  await emitPtyOutput(page, '\r\n\x1b]133;A\x07');
  await expect(surface).toBeHidden();
  await expect(page.getByPlaceholder(/输入命令/).last()).toBeVisible();
});

test('canceling authentication closes the PTY and leaves no editable password field', async ({ page }) => {
  await openSsh(page, 'known');
  const surface = page.getByTestId('ssh-connection-input');
  await expect(surface).toBeVisible();
  await emitPtyOutput(page, "user@server's password: ");
  const response = surface.getByLabel('SSH 认证响应');
  await expect(response).toBeEnabled();
  await expect(response).toHaveCSS('font-size', '13px');
  await expect(response).toHaveCSS('line-height', '32px');
  await expect(response).toHaveCSS('padding', '0px');
  await response.locator('..').screenshot({ path: test.info().outputPath('ssh-auth-empty.png') });
  await response.fill('unsent-secret');
  await expect(response).toHaveCSS('font-size', '20px');
  await expect(response).toHaveCSS('letter-spacing', '2px');
  await surface.getByRole('button', { name: '取消认证' }).click();
  await expect(surface.getByRole('status')).toHaveText('已取消认证，SSH 连接已关闭');
  expect(await ipcRecords(page, '__PTY_CLOSES__')).toContainEqual({ id: 'e2e-session' });
  await expect(response).toHaveCount(0);
  expect(await ptyWrites(page)).not.toContain('unsent-secret\r');
  expect(await ptyWrites(page)).not.toContain('\x03');
  await emitPtyOutput(page, 'late password prompt');
  await expect(surface.locator('pre')).not.toContainText('late password prompt');
});

test('a logged-in SSH command does not retain the previous password prompt', async ({ page }) => {
  await openSsh(page, 'known');
  const surface = page.getByTestId('ssh-connection-input');
  await emitPtyOutput(page, "user@server's password: ");
  await expect(surface.getByLabel('SSH 认证响应')).toBeEnabled();
  await emitPtyOutput(page, "user@server's password: \r\n\x1b]133;A\x07user@server's password: \r\nls\r\n\x1b]133;E;bHM=\x07\x1b]133;C\x07\x1b[H\x1b[2Jfile.txt\r\n\x1b]133;D;0\x07\x1b]133;A\x07");
  await expect(surface).toBeHidden();
  await expect(page.getByLabel('SSH 认证响应')).toHaveCount(0);
  await expect(page.getByText('file.txt', { exact: true })).toBeVisible();
  await expect(page.getByText("user@server's password:", { exact: true })).toBeHidden();
});

test('canceling host trust does not spawn SSH or record a key', async ({ page }) => {
  await openSsh(page, 'unknown', false);
  await expect(page.getByTestId('ssh-connection-input').locator('pre')).toContainText('已取消 SSH 连接');
  expect(await ipcRecords(page, '__SSH_TRUSTS__')).toEqual([]);
  expect((await ipcRecords(page, '__PTY_SPAWNS__')).filter(s => s.ssh)).toEqual([]);
  // 未出现密码提示时没有可输入的认证框
  await expect(page.getByLabel('SSH 认证响应')).toHaveCount(0);
});

test('changed host keys fail without asking to overwrite trust', async ({ page }) => {
  await openSsh(page, 'changed');
  await expect(page.getByTestId('ssh-connection-input').locator('pre')).toContainText('主机密钥不匹配');
  expect(await ipcRecords(page, '__SSH_DIALOGS__')).toEqual([]);
  expect(await ipcRecords(page, '__SSH_TRUSTS__')).toEqual([]);
  expect((await ipcRecords(page, '__PTY_SPAWNS__')).filter(s => s.ssh)).toEqual([]);
});
