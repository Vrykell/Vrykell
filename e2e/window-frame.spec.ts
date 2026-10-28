import { expect, test } from '@playwright/test';
import { setupTauriMock, windowFrameCalls } from './tauri-mock';
import { gotoSetting } from './settings';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
});

/** The native frame uses the shared neutral gray border in either theme. */
test('the native window frame follows the neutral border color', async ({ page }) => {
  const border = () => page.evaluate(() => document.documentElement.style.getPropertyValue('--border-strong').trim());
  const lastCall = async () => (await windowFrameCalls(page)).at(-1)!;

  const boot = await lastCall();
  expect(boot.label).toBe('main');
  expect(boot.color).toBe(await border());

  await gotoSetting(page, '主题');
  await page.getByRole('radio', { name: '始终浅色', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const light = await border();
  expect(light).not.toBe(boot.color);
  await expect.poll(async () => (await lastCall()).color).toBe(light);
});
