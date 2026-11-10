import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

for (const width of [900, 1440]) test(`concise model help at ${width}px`, async ({ page }, info) => {
  await setupTauriMock(page);
  await page.setViewportSize({ width, height: 800 });
  await page.goto('/');
  await gotoSetting(page, '模型行为');
  const help = page.getByText('输入预算不超过服务商上限，0 为不限。', { exact: true });
  await expect(help).toBeVisible();
  expect(await help.evaluate(element => element.getBoundingClientRect().height / parseFloat(getComputedStyle(element).lineHeight))).toBeLessThan(1.5);
  await page.locator('.settings-view').screenshot({ path: info.outputPath(`concise-settings-${width}.png`) });
});
