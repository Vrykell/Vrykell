import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

test('page scrollbars stay below an open dialog and become usable again after closing', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await gotoSetting(page, '打开方式');
  await page.setViewportSize({ width: 900, height: 680 });
  const navigation = page.locator('.settings-navigation .scroll-region');
  await expect(navigation).toHaveClass(/overlay-scroll-target/);
  const id = await navigation.getAttribute('id');
  const rail = page.locator(`[role="scrollbar"][aria-controls="${id}"]`);
  await expect(rail).toBeVisible();
  await page.getByTestId('tab-new-btn').click();
  const dialog = page.getByRole('dialog', { name: '新建标签页' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS('opacity', '1');
  await expect.poll(() => dialog.evaluate(element => getComputedStyle(element.parentElement!).opacity)).toBe('1');
  const point = await dialog.evaluate((element, railId) => {
    const popup = element.getBoundingClientRect();
    const bar = document.querySelector(`[role="scrollbar"][aria-controls="${railId}"]`)!.getBoundingClientRect();
    return { x: bar.x + bar.width / 2, y: popup.y + popup.height / 2,
      inside: bar.x >= popup.x && bar.right <= popup.right && popup.y >= bar.y && popup.bottom <= bar.bottom };
  }, id);
  expect(point.inside).toBe(true);
  await expect.poll(() => page.evaluate(point => document.elementFromPoint(point.x, point.y)?.closest('[role="dialog"]')?.getAttribute('aria-label'), point)).toBe('新建标签页');
  await page.mouse.move(point.x, point.y);
  await page.screenshot({ path: test.info().outputPath('dialog-over-settings-scrollbar.png') });
  await dialog.getByPlaceholder('搜索标签页类型…').press('Escape');
  await expect(dialog).toBeHidden();
  await expect.poll(() => page.evaluate(point => document.elementFromPoint(point.x, point.y)?.closest('[role="scrollbar"]')?.getAttribute('aria-controls'), point)).toBe(id);
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, 240);
  await expect.poll(() => navigation.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
});
