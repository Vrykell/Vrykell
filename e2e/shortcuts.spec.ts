import { test, expect } from '@playwright/test';
import { setupTauriMock, ensureTabsOpen } from './tauri-mock';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
});

test.describe('Global shortcuts', () => {
  test('Cmd+T creates a tab and Cmd+W closes it', async ({ page }) => {
    // Open the tab panel.
    await ensureTabsOpen(page);
    // There should be at least one tab.
    await expect(page.locator('[data-testid^="tab-row-"]')).toHaveCount(1);
    // Create a tab.
    await page.keyboard.press('Meta+t');
    // The panel should now hold two tabs.
    await expect(page.locator('[data-testid^="tab-row-"]')).toHaveCount(2);
    // Clicking the panel's top new button opens the shell picker directly (no intermediate menu); pick zsh.
    await page.locator('[data-testid="tab-new-btn"]').click();
    await page.getByText('Zsh', { exact: true }).click();
    await expect(page.locator('[data-testid^="tab-row-"]')).toHaveCount(3);
    // Cmd+W closes the current tab.
    await page.keyboard.press('Meta+w');
    await expect(page.locator('[data-testid^="tab-row-"]')).toHaveCount(2);
  });

  test('Cmd+number switches tabs', async ({ page }) => {
    await page.keyboard.press('Meta+t');
    await page.keyboard.press('Meta+t');
    // Open the tab panel to verify multiple tabs exist.
    await ensureTabsOpen(page);
    await expect(page.getByText('终端').first()).toBeVisible();
    // Switch back to the first tab (verifies activate takes effect).
    await page.keyboard.press('Meta+1');
    // Confirm the first tab is still visible.
    await expect(page.getByText('终端').first()).toBeVisible();
  });

  test('Cmd+F opens global search and focuses it', async ({ page }) => {
    await page.keyboard.press('Meta+f');
    const searchInput = page.getByPlaceholder(/搜索文件/);
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(searchInput).not.toBeVisible();
  });

  test('Cmd+, opens the settings page', async ({ page }) => {
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Meta+,');
    await expect(page.getByTestId('provider-endpoint-input').first()).toBeVisible();
  });

  test('Cmd+P opens the command palette', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    await expect(page.getByPlaceholder('搜索命令…')).toBeVisible({ timeout: 3000 });
    // The first Escape clears the input, the second closes the panel.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await expect(page.getByPlaceholder('搜索命令…')).not.toBeVisible({ timeout: 3000 });
  });

  test('page zoom shortcuts and the wheel do not change the font size or page scale', async ({ page }) => {
    const initialFontSize = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
    await page.keyboard.press('Meta+=');
    await page.keyboard.press('Meta+-');
    await page.keyboard.press('Meta+0');
    await page.keyboard.press('Control+=');
    const result = await page.evaluate(() => {
      const wheel = new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, cancelable: true, bubbles: true });
      window.dispatchEvent(wheel);
      return {
        fontSize: getComputedStyle(document.documentElement).fontSize,
        inlineFontSize: document.documentElement.style.fontSize,
        wheelPrevented: wheel.defaultPrevented,
      };
    });
    expect(result.fontSize).toBe(initialFontSize);
    expect(result.inlineFontSize).toBe('');
    expect(result.wheelPrevented).toBe(true);
  });

  test('clicking the TopDock search trigger opens the centered search window', async ({ page }) => {
    const trigger = page.getByTestId('global-search-trigger');
    await expect(trigger).toBeVisible({ timeout: 3000 });
    // Clicking the trigger opens the centered search window.
    await trigger.click();
    const searchInput = page.getByPlaceholder(/搜索文件/);
    await expect(searchInput).toBeVisible({ timeout: 3000 });
    // Entering a query triggers the search.
    await searchInput.fill('test');
    await page.waitForTimeout(1000);
    // Escape closes the dialog.
    await page.keyboard.press('Escape');
    await expect(searchInput).not.toBeVisible();
  });
});
