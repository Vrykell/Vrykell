import { test } from '@playwright/test';
import { setupTauriMock } from '../e2e/tauri-mock';
import { gotoSetting } from '../e2e/settings';

test('debug skill toggle 2', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await gotoSetting(page, '技能');
  const row = page.locator('section').getByText('旧脚本技能', { exact: true }).first().locator('xpath=ancestor::div[2]');
  await row.getByRole('button', { name: '信任' }).click();
  await page.waitForTimeout(400);
  await row.getByRole('button', { name: '启用' }).click();
  await page.waitForTimeout(600);
  const list = await page.evaluate(async () => {
    const inv = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke;
    return inv('list_skills');
  });
  console.log('MOCK LIST:', JSON.stringify(list));
  console.log('ROW HTML:', (await row.innerHTML()).slice(0, 400));
});
