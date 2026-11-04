import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

/**
 * The engine's insertion point is one pixel wide and CSS cannot widen it, so the shared fields
 * paint their own bar. These checks cover the visible behaviour: it shows while a field owns the
 * insertion point, follows typing, and steps aside for a range selection or an opt-out field.
 */
test('paints a thicker caret in the shared text fields', async ({ page }) => {
  await setupTauriMock(page, {});
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();

  await page.getByTestId('global-search-trigger').click();
  const dialog = page.getByRole('dialog', { name: '全局搜索' });
  const input = dialog.getByRole('textbox', { name: '搜索工作区' });
  const caret = page.locator('.text-caret');

  await expect(caret).toBeVisible();
  await expect(input).toHaveCSS('caret-color', 'rgba(0, 0, 0, 0)');
  const width = (await caret.boundingBox())!.width;
  expect(width).toBeGreaterThan(1);
  expect(width).toBeLessThan(2);
  expect((await caret.boundingBox())!.height).toBeGreaterThan(6);

  const start = (await caret.boundingBox())!.x;
  await input.pressSequentially('abc');
  expect((await caret.boundingBox())!.x).toBeGreaterThan(start);

  // A range selection has no insertion point.
  await page.keyboard.press('Control+a');
  await expect(caret).toBeHidden();
  await expect(input).not.toHaveCSS('caret-color', 'rgba(0, 0, 0, 0)');

  await input.click();
  await expect(caret).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(caret).toBeHidden();
});

test('leaves the terminal command line on its native caret', async ({ page }) => {
  await setupTauriMock(page, {});
  await page.goto('/');
  const input = page.getByPlaceholder(/输入命令/);
  await expect(input).toBeVisible();
  await input.click();
  await input.fill('echo hi');
  // The command line paints its own syntax mirror and keeps the engine caret.
  await expect(page.locator('.text-caret')).toBeHidden();
  await expect(input).not.toHaveCSS('caret-color', 'rgba(0, 0, 0, 0)');
});

test('keeps a multiline caret within its visible input while editing and scrolling', async ({ page }) => {
  await setupTauriMock(page, {});
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await page.getByTestId('workspace-area-ai').click();
  await page.getByTestId('harness-add-session').click();
  await page.getByTestId('acp-launcher-Fake ACP').click();
  const input = page.getByTestId('harness-composer');
  const caret = page.locator('.text-caret');
  await input.fill(Array.from({ length: 20 }, (_, index) => `Line ${index}`).join('\n'));
  await input.evaluate((element: HTMLTextAreaElement) => {
    element.setSelectionRange(2, 2);
    element.scrollTop = 0;
    element.dispatchEvent(new Event('select', { bubbles: true }));
  });
  await expect(caret).toBeVisible();
  const lineHeight = await input.evaluate(element => parseFloat(getComputedStyle(element).lineHeight));
  expect((await caret.boundingBox())!.height).toBeLessThanOrEqual(lineHeight);
  await input.evaluate(element => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect(caret).toBeHidden();
  await input.evaluate(element => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect(caret).toBeVisible();
});
