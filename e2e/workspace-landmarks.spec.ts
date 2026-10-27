import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test('keeps landmarks unique and empty tab search outside the tablist', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByTestId('workspace-area-terminal')).toHaveAttribute('aria-current', 'page');

  await expect(page.locator('header.workspace-titlebar')).toHaveCount(1);

  const resize = page.locator('.workspace-sidebar-resize');
  await expect(resize).toHaveAttribute('role', 'region');
  await expect(resize.getByRole('separator')).toBeVisible();

  await page.getByTestId('tab-search-toggle').click();
  await page.getByTestId('tab-search').fill('no-such-terminal-title');
  const empty = page.locator('.folder-tab-empty .search-empty-state');
  await expect(empty).toBeVisible();
  await expect(page.locator('.terminal-tab-list .search-empty-state')).toHaveCount(0);
});
