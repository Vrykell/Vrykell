import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

for (const width of [1240, 760]) test(`diagnostics use standard settings switches at ${width}px`, async ({ page }, info) => {
  await setupTauriMock(page);
  await page.addInitScript(mode => localStorage.setItem('vrykell-theme-mode', mode), width === 760 ? 'light' : 'dark');
  await page.setViewportSize({ width, height: 800 });
  await page.goto('/');
  await gotoSetting(page, '日志与诊断');
  const automatic = page.getByRole('switch', { name: '自动保存日志' });
  const input = page.getByRole('switch', { name: '跟踪终端输入' });
  await expect(page.locator('.settings-toggle > [role="switch"]')).toHaveCount(2);
  await expect(automatic).toHaveAttribute('aria-checked', 'false');
  await automatic.click();
  await expect(automatic).toHaveAttribute('aria-checked', 'true');
  await expect(automatic).toBeEnabled();
  await input.focus();
  await page.keyboard.press('Space');
  await expect(input).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('vrykell-terminal-input-trace'))).toBe('1');
  await page.keyboard.press('Enter');
  await expect(input).toHaveAttribute('aria-checked', 'false');
  await automatic.click();
  await expect(automatic).toHaveAttribute('aria-checked', 'false');
  await page.screenshot({ path: info.outputPath(`diagnostics-switches-${width}.png`) });
});

test('startup preference is discoverable and persists the restore toggle', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await gotoSetting(page, '启动');
  const toggle = page.getByRole('switch', { name: '启动时恢复会话历史' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
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

test('closing the final tab leaves the placeholder start page without a stale reconnect view', async ({ page }) => {
  await setupTauriMock(page, { integration: false });
  await page.addInitScript(() => localStorage.setItem('vrykell-agent-settings', JSON.stringify({ version: 8, state: { global: { sshOpenMode: 'block' }, overrides: {} } })));
  await page.goto('/');
  const initialTab = page.locator('[data-tab-row-id]').first();
  await initialTab.hover();
  await initialTab.locator('[data-testid^="tab-close-"]').click();
  // The last tab closes to the area's placeholder start page: the strip never goes empty (TB10).
  await expect(page.locator('[data-tab-row-id]')).toHaveCount(1);
  await expect(page.locator('[data-tab-row-id]').first()).toContainText('开始');
  await expect(page.getByTestId('session-history-page')).toHaveCount(0);
  await page.locator('[data-dock-btn="ssh"]').click();
  await page.getByTestId('ssh-row-ssh-1').dblclick();
  await expect(page.getByTestId('ssh-connection-input')).toBeVisible();
  await page.locator('[data-dock-btn="tabs"]').click();
  const sshTab = page.locator('[data-tab-row-id]').first();
  await sshTab.hover();
  const closeTab = sshTab.locator('[data-testid^="tab-close-"]');
  await closeTab.click();
  await expect(page.locator('[data-tab-row-id]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '重新连接' })).toHaveCount(0);
});
