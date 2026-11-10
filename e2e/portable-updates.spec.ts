import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

test('portable distribution exposes its version without update controls', async ({ page }) => {
  test.skip(process.env.VITE_DISABLE_UPDATES !== 'true', 'Requires the portable frontend build flag');
  await setupTauriMock(page);
  await page.goto('/');
  await gotoSetting(page, '关于');
  await expect(page.getByTestId('application-version')).toBeVisible();
  await expect(page.getByRole('button', { name: '检查更新' })).toHaveCount(0);
  expect(await page.evaluate(async () => {
    const path = '/src/platform/updater.ts';
    const updater = await import(path) as typeof import('../src/platform/updater');
    return { supported: updater.supportsAppUpdates(), update: await updater.checkApplicationUpdate() };
  })).toEqual({ supported: false, update: null });
});
