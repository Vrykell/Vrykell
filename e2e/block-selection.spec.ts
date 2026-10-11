import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test('命令块头部（路径等）与命令行可被鼠标选中复制', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  const input = page.getByPlaceholder(/输入命令/);
  await expect(input).toBeVisible({ timeout: 5000 });
  await input.fill('echo selectable-block');
  await input.press('Enter');

  const block = page.locator('[data-testid^="command-block-"]').last();
  await expect(block).toContainText('selectable-block', { timeout: 5000 });

  // The whole context row is selectable, not just the command line, so the path can be copied.
  const info = block.locator('.command-block-info').first();
  await expect(info).toHaveAttribute('data-selectable', 'true');
  const cwd = info.locator('.command-block-cwd');
  await expect(cwd).toBeVisible();

  const box = (await cwd.boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();

  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '');
  expect(selected.length).toBeGreaterThan(0);
  expect(selected).toContain('/');
  await page.screenshot({ path: test.info().outputPath('block-header-selection.png') });
});
