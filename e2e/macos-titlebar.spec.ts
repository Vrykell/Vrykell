import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test.use({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15' });

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByTestId('global-search-trigger')).toBeVisible();
});

for (const width of [720, 1240]) {
  test(`native controls, title, search and actions have room at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const header = page.locator('.workspace-titlebar');
    await expect(header).toHaveAttribute('data-platform', 'macos');
    await expect(page.getByTestId('window-controls')).toHaveCount(0);
    const sidebarWidth = width <= 900 ? 0 : 208;
    const inset = Math.max(16, 92 - sidebarWidth);
    await expect(page.locator('.workspace-title')).toHaveCSS('padding-left', `${inset}px`);
    const search = (await page.getByTestId('global-search-trigger').boundingBox())!;
    const title = (await page.locator('.workspace-title span').boundingBox())!;
    const ai = (await page.locator(width <= 760 ? '[data-testid="auxiliary-more"]' : '[data-dock-btn="chat"]').boundingBox())!;
    expect(title.x).toBe(sidebarWidth + inset + (sidebarWidth === 0 ? 36 : 0));
    expect(title.width).toBeGreaterThan(0);
    expect(title.x + title.width).toBeLessThan(search.x);
    expect(Math.abs(search.x + search.width / 2 - (sidebarWidth + (width - sidebarWidth) / 2))).toBeLessThan(1);
    expect(search.x + search.width).toBeLessThan(ai.x);
    expect(width - ai.x - ai.width).toBe(16);
    await expect(header).toHaveCSS('height', '42px');
    expect(ai.y + ai.height / 2).toBe(21);
    expect(search.y + search.height / 2).toBe(21);
    const dragHit = await page.evaluate(x => document.elementFromPoint(x, 21)?.hasAttribute('data-tauri-drag-region'), sidebarWidth + 8);
    expect(dragHit).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`macos-titlebar-${width}.png`), animations: 'disabled' });
    await page.getByTestId('global-search-trigger').click();
    await expect(page.getByPlaceholder(/搜索文件、命令、设置/)).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+,');
    await expect(page.getByTestId('provider-endpoint-input').first()).toBeVisible();
  });
}

test('fullscreen releases the traffic-light space and restores it on exit', async ({ page }) => {
  const setFullscreen = async (value: boolean) => {
    await page.evaluate(fullscreen => {
      const bridge = (window as unknown as { __TAURI_INTERNALS__: { setFullscreen: (value: boolean) => void } }).__TAURI_INTERNALS__;
      bridge.setFullscreen(fullscreen);
    }, value);
  };
  await setFullscreen(true);
  await expect(page.locator('.workspace-title')).toHaveCSS('padding-left', '20px');
  await setFullscreen(false);
  await expect(page.locator('.workspace-title')).toHaveCSS('padding-left', '16px');
  await expect(page.locator('.workspace-title-actions')).toHaveCSS('padding-right', '16px');
});
