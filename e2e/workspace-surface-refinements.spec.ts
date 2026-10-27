import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

for (const theme of ['深色', '浅色']) test(`acrylic is confined to navigation and region edges stay square in ${theme}`, async ({ page }, info) => {
  await setupTauriMock(page); await page.goto('/');
  await gotoSetting(page, '主题'); await page.getByRole('radio', { name: theme, exact: true }).click();
  await page.keyboard.press('Escape');
  await page.locator('[data-dock-btn="files"]').click();
  const sidebar = page.getByTestId('workspace-sidebar');
  const materialColor = await sidebar.evaluate(element => getComputedStyle(element).backgroundColor);
  // The navigation stays translucent over the native material, but mostly opaque so text and
  // icons keep their contrast; the exact scrim ratio is a theme token.
  const alpha = Number(/(?:rgba\([^)]*,\s*([\d.]+)\)|\/\s*([\d.]+)\))/.exec(materialColor)?.slice(1).find(value => value !== undefined));
  expect(alpha).toBeGreaterThan(0.5);
  expect(alpha).toBeLessThan(1);
  for (const selector of ['.workspace-titlebar', '.workspace-body', '.workspace-main', '.workspace-side-panel > div:first-child']) {
    const color = await page.locator(selector).first().evaluate(element => getComputedStyle(element).backgroundColor);
    expect(color).not.toMatch(/rgba\([^)]*,\s*0(?:\.\d+)?\)/);
  }
  for (const selector of ['.workspace-main', '.workspace-side-panel']) await expect(page.locator(selector).first()).toHaveCSS('border-radius', '0px');
  expect((await sidebar.locator('.sidebar-row-content').first().boundingBox())!.height).toBe(32);
  await expect(sidebar.locator('.workspace-sidebar-footer [role="button"]')).toHaveCount(1);
  await page.screenshot({ path: info.outputPath(`refined-workspace-${theme}.png`), animations: 'disabled' });
  await gotoSetting(page, '主题');
  await page.getByRole('switch', { name: '桌面材质', exact: true }).click();
  await page.keyboard.press('Escape');
  expect(await sidebar.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(materialColor);
});

test('terminal dragging carries the complete tab and closing preview never closes the session', async ({ page }, info) => {
  await setupTauriMock(page); await page.goto('/');
  await page.keyboard.press('Control+t');
  const tabs = page.locator('[data-tab-row-id]');
  const row = tabs.first(); const box = (await row.boundingBox())!;
  const title = await row.getByRole('tab').innerText();
  await page.mouse.move(box.x + 35, box.y + 16); await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 80, { steps: 6 });
  const preview = page.locator('[data-reorder-preview="item"]');
  await expect(preview).toBeVisible();
  await expect(preview.getByRole('tab', { includeHidden: true })).toContainText(title);
  await expect(preview.locator('.icon-button')).toHaveCount(1);
  expect((await preview.boundingBox())!.width).toBeCloseTo(box.width, 0);
  await page.screenshot({ path: info.outputPath('whole-terminal-tab-drag.png') });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(tabs).toHaveCount(2);
});
