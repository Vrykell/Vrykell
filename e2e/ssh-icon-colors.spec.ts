import { expect, test } from '@playwright/test';
import { setupTauriMock, ensureTabsOpen } from './tauri-mock';

for (const theme of ['dark', 'light']) test(`remote icons are shared across profiles, hosts and tabs in ${theme}`, async ({ page }, info) => {
  await setupTauriMock(page, {});
  await page.addInitScript(theme => {
    localStorage.setItem('vrykell-theme-mode', theme);
    localStorage.setItem('vrykell-ssh-workspace-view', 'manage');
  }, theme);
  await page.goto('/');
  await page.getByTestId('tab-new-btn').click();
  await expect(page.getByTestId('new-tab-option-ssh:ssh-1').locator('[data-shell-mark]')).toHaveAttribute('data-shell-mark', 'linux');
  await page.keyboard.press('Escape');
  await page.locator('[data-dock-btn="ssh"]').click();
  const connection = page.getByTestId('ssh-row-ssh-1');
  await expect(connection.locator('[data-shell-mark]')).toHaveAttribute('data-shell-mark', 'linux');
  await connection.click({ button: 'right' });
  await expect(page.getByRole('group', { name: '图标颜色' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await connection.dblclick();
  await ensureTabsOpen(page);
  const tab = page.locator('[data-tab-kind="session"]').filter({ hasText: '生产服务器' });
  await expect(tab.locator('[data-shell-mark]')).toHaveAttribute('data-shell-mark', 'linux');
  await page.screenshot({ path: info.outputPath(`remote-identities-${theme}.png`) });
});
