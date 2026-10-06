import { test, expect, type Page } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

async function resizeChat(page: Page, width: number) {
  const panel = page.locator('.workspace-side-panel[data-side="right"]');
  const bounds = (await panel.boundingBox())!;
  const handle = (await page.getByTestId('resize-handle-chat').boundingBox())!;
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + bounds.width - width, y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => panel.evaluate(element => element.clientWidth)).toBe(width);
}

test('AI composer recovers its compact height after narrowing, widening and reopening', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await page.locator('[data-dock-btn="chat"]').click();
  const input = page.getByPlaceholder(/自然语言描述/);
  const composer = page.locator('.workspace-side-panel[data-side="right"] .terminal-composer');
  await expect(input).toBeVisible();
  await resizeChat(page, 480);
  for (const value of ['', '测试布局恢复后的输入区域尺寸。'.repeat(3)]) {
    await input.fill(value);
    const height = await input.evaluate(element => element.clientHeight);
    const cardHeight = await composer.evaluate(element => element.clientHeight);
    await resizeChat(page, 180);
    await expect.poll(() => input.evaluate(element => element.clientHeight)).toBeGreaterThan(height);
    await resizeChat(page, 480);
    await expect.poll(() => input.evaluate(element => element.clientHeight)).toBe(height);
    await expect.poll(() => composer.evaluate(element => element.clientHeight)).toBe(cardHeight);
    await expect(input).toHaveValue(value);
  }
  await page.locator('[data-dock-btn="chat"]').click();
  await page.locator('[data-dock-btn="chat"]').click();
  await expect(input).toHaveValue('测试布局恢复后的输入区域尺寸。'.repeat(3));
  await input.press('Escape');
  await expect(input).toHaveValue('');
  await expect.poll(() => input.evaluate(element => element.clientHeight)).toBeLessThan(30);
});

test('terminal composer restores its height when the window width returns', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  const input = page.getByPlaceholder(/输入命令/);
  const value = 'echo '.repeat(30);
  await input.fill(value);
  const height = await input.evaluate(element => element.clientHeight);
  await page.setViewportSize({ width: 650, height: 800 });
  await expect.poll(() => input.evaluate(element => element.clientHeight)).toBeGreaterThan(height);
  await page.setViewportSize({ width: 1240, height: 800 });
  await expect.poll(() => input.evaluate(element => element.clientHeight)).toBe(height);
  await expect(input).toHaveValue(value);
});
