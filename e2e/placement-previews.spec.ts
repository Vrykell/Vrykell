import { expect, test, type Locator } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { focusedPane, hoverPlacementZone } from './placement';

async function opacity(preview: Locator) {
  return preview.evaluate(element => {
    const color = getComputedStyle(element).backgroundColor;
    const alpha = color.match(/\/\s*([\d.]+)\s*\)$/)?.[1] ?? color.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/)?.[1];
    return alpha ? Number(alpha) : 1;
  });
}
for (const theme of ['dark', 'light'] as const) test(`panel and split previews share a nearly opaque surface in ${theme} mode`, async ({ page }) => {
  await setupTauriMock(page); await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await page.evaluate(async theme => { const { applyTheme } = await import('/src/config/theme/tokens.ts'); applyTheme(theme); }, theme);
  const button = (await page.locator('[data-dock-btn="files"]').boundingBox())!;
  const body = (await page.locator('.workspace-body').boundingBox())!;
  await page.mouse.move(button.x + 16, button.y + 16); await page.mouse.down();
  await page.mouse.move(body.x + body.width - 90, body.y + 250, { steps: 8 });
  const panel = page.getByTestId('panel-drop-preview'); await expect(panel).toBeVisible();
  await expect.poll(() => opacity(panel)).toBeGreaterThanOrEqual(0.95);
  const panelColor = await panel.evaluate(element => getComputedStyle(element).backgroundColor);
  await page.screenshot({ path: test.info().outputPath(`panel-preview-${theme}.png`) });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await page.keyboard.press('Meta+d'); await hoverPlacementZone(page, focusedPane(page), 'right');
  const split = page.getByTestId('placement-zone-1');
  await expect(split).toHaveText('点击此处分裂终端');
  await expect.poll(() => opacity(split)).toBeGreaterThanOrEqual(0.95);
  expect(await split.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(panelColor);
  await page.screenshot({ path: test.info().outputPath(`split-preview-${theme}.png`) });
  await page.setViewportSize({ width: 720, height: 500 }); await hoverPlacementZone(page, focusedPane(page), 'right');
  await expect(split.getByText('点击此处分裂终端')).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath(`split-preview-${theme}-narrow.png`) });
  await page.keyboard.press('Escape'); await expect(split).toHaveCount(0);
});
