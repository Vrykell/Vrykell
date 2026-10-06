import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

test('startup preference is discoverable and persists the selected mode', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await gotoSetting(page, '启动');
  const picker = page.getByRole('combobox', { name: '启动时打开' });
  await picker.click();
  await page.getByRole('option', { name: '显示会话记录' }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('vrykell-startup-mode'))).toBe('empty');
  await expect(page.getByRole('status')).toHaveText('已保存');
});

test('detailed log export works with disk logging disabled by default', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await gotoSetting(page, '日志与诊断');
  await expect(page.getByRole('switch', { name: '自动保存日志' })).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('button', { name: '导出详细日志' }).click();
  await expect(page.getByTestId('logs-export-status')).toContainText('已导出到');
  const exports = await page.evaluate(() => (window as unknown as { __DIAGNOSTICS_EXPORTS__: Record<string, unknown>[] }).__DIAGNOSTICS_EXPORTS__);
  expect(exports).toHaveLength(1);
  expect(exports[0]?.path).toContain('vrykell-diagnostics');
  expect(Array.isArray(exports[0]?.frontend)).toBe(true);
});

test('closing the final SSH tab leaves session history without a stale reconnect view', async ({ page }) => {
  await setupTauriMock(page, { integration: false });
  await page.addInitScript(() => localStorage.setItem('vrykell-agent-settings', JSON.stringify({ version: 8, state: { global: { sshOpenMode: 'block' }, overrides: {} } })));
  await page.goto('/');
  const initialTab = page.locator('[data-tab-row-id]').first();
  await initialTab.hover();
  await initialTab.locator('[data-testid^="tab-close-"]').click();
  await expect(page.getByText('会话历史', { exact: true }).first()).toBeVisible();
  await page.locator('[data-dock-btn="ssh"]').click();
  await page.getByTestId('ssh-row-ssh-1').dblclick();
  await expect(page.getByTestId('ssh-connection-input')).toBeVisible();
  await page.locator('[data-dock-btn="tabs"]').click();
  const sshTab = page.locator('[data-tab-row-id]').first();
  await sshTab.hover();
  const closeTab = sshTab.locator('[data-testid^="tab-close-"]');
  await closeTab.click();
  await expect(page.locator('[data-tab-row-id]')).toHaveCount(0);
  await expect(page.getByText('会话历史', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '重新连接' })).toHaveCount(0);
});
