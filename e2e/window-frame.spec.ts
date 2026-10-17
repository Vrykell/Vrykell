import { expect, test } from '@playwright/test';
import { setupTauriMock, windowFrameCalls } from './tauri-mock';
import { gotoSetting } from './settings';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
});

/**
 * The operating system frames the window with a one pixel border; the app paints it in the
 * color of the content that touches the frame, so the theme switch must repaint it too.
 */
test('the native window frame follows the color touching it', async ({ page }) => {
  const chrome = () => page.evaluate(() => document.documentElement.style.getPropertyValue('--chrome-bg').trim());
  const lastCall = async () => (await windowFrameCalls(page)).at(-1)!;

  const boot = await lastCall();
  expect(boot.label).toBe('main');
  expect(boot.color).toBe(await chrome());

  await gotoSetting(page, '主题');
  await page.getByRole('radio', { name: '浅色', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const light = await chrome();
  expect(light).not.toBe(boot.color);
  await expect.poll(async () => (await lastCall()).color).toBe(light);
});
