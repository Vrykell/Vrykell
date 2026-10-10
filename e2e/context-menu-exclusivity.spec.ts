import { test, expect } from '@playwright/test';
import { ensureTabsOpen, setupTauriMock } from './tauri-mock';

test('unrelated context menus replace each other, including programmatic right clicks', async ({ page }) => {
  await setupTauriMock(page); await page.goto('/');
  const input = page.getByPlaceholder(/输入命令/);
  await input.fill('echo menu-exclusive'); await input.press('Enter');
  const block = page.locator('[data-testid^="command-block-"]').filter({ hasText: 'echo menu-exclusive' });
  await ensureTabsOpen(page);
  await page.getByTestId('tab-row-t1').click({ button: 'right' });
  await expect(page.getByRole('menu')).toHaveCount(1);
  await expect(page.getByRole('menu')).toContainText('重命名');
  await block.dispatchEvent('contextmenu', { clientX: 600, clientY: 180 });
  await expect(page.getByRole('menu')).toHaveCount(1);
  await expect(page.getByRole('menu', { name: '命令块操作' })).toBeVisible();
  await input.dispatchEvent('contextmenu', { clientX: 800, clientY: 450 });
  await expect(page.getByRole('menu')).toHaveCount(1);
  await expect(page.getByRole('menu')).toContainText('关闭终端');
  await expect(page.getByRole('menu', { name: '命令块操作' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
});
