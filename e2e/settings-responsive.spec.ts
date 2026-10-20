import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

for (const theme of ['深色', '浅色']) {
  test(`settings keep their directory and close control available in ${theme}`, async ({ page }, info) => {
    await setupTauriMock(page);
    await page.goto('/');
    await gotoSetting(page, '主题');
    await page.getByRole('radio', { name: theme, exact: true }).click();
    const nav = page.locator('.settings-navigation');
    await nav.getByRole('button', { name: '模型配置', exact: true }).click();
    for (const width of [1240, 900, 720, 480]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(nav).toBeVisible();
      await expect(page.getByRole('button', { name: '关闭设置', exact: true })).toBeVisible();
      await expect(page.locator('.settings-navigation-toggle, .settings-navigation-backdrop')).toHaveCount(0);
      const settings = (await page.locator('.settings-screen').boundingBox())!;
      expect(settings.x).toBe(40);
      expect(settings.width).toBe(width - 48);
      expect((await nav.boundingBox())!.width).toBeGreaterThanOrEqual(180);
      await page.screenshot({ path: info.outputPath(`settings-${width}.png`), animations: 'disabled' });
    }
    await nav.getByRole('button', { name: '模型行为', exact: true }).click();
    await expect(page.getByRole('heading', { name: '模型行为', exact: true })).toBeVisible();
    await expect(nav).toBeVisible();
  });
}

test('settings cover both auxiliary panels and preserve their workspace layout', async ({ page }) => {
  await setupTauriMock(page); await page.goto('/');
  await page.locator('[data-dock-btn="chat"]').click();
  const input = page.locator('[data-terminal-input]').first();
  await input.fill('preserved draft');
  const before = await page.locator('.workspace-main').boundingBox();
  await gotoSetting(page, '模型行为');
  await expect(page.locator('.workspace-side-panel[data-visible="true"]')).toHaveCount(2);
  for (const panel of await page.locator('.workspace-side-panel[data-visible="true"]').all()) {
    await expect(panel).toBeHidden(); await expect(panel).toHaveAttribute('inert', '');
  }
  expect((await page.locator('.settings-screen').boundingBox())!.width).toBe(1192);
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  expect(await page.locator('.workspace-main').boundingBox()).toEqual(before);
  await expect(input).toHaveValue('preserved draft');
});
