import { test, expect } from '@playwright/test';
import { setupTauriMock, ensureTabsOpen } from './tauri-mock';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
});

test.describe('Application layout', () => {
  test('TopDock actions: tabs and files buttons plus the settings entry', async ({ page }) => {
    // Navigation actions remain discoverable in the activity bar.
    await expect(page.locator('[data-dock-btn="tabs"]')).toBeVisible();
    await expect(page.locator('[data-dock-btn="files"]')).toBeVisible();
    await expect(page.locator('[data-dock-btn="settings"]')).toBeVisible();
    await expect(page.getByTestId('tab-search-toggle')).toBeVisible();
    await expect(page.getByText('Documents')).toHaveCount(0);
    await expect(page.locator('[data-testid="ssh-search"]')).toBeHidden();
  });

  test('Windows/Linux use in-app window controls', async ({ page }) => {
    test.skip(await page.evaluate(() => /Mac/.test(navigator.userAgent)), 'macOS uses the native traffic lights');
    const controls = page.locator('[data-testid="window-controls"]');
    await expect(controls).toBeVisible();
    await expect(controls.locator('button')).toHaveCount(3);
    const controlRight = await controls.evaluate((element) => element.getBoundingClientRect().right);
    const viewportRight = await page.evaluate(() => window.innerWidth);
    expect(viewportRight - controlRight).toBe(0);
    for (const width of [1240, 720]) {
      await page.setViewportSize({ width, height: 800 });
      const titlebar = await page.locator('.workspace-titlebar').boundingBox();
      expect(titlebar!.height).toBe(42);
      for (const id of ['window-minimize', 'window-maximize', 'window-close']) {
        const button = page.getByTestId(id);
        const rect = await button.boundingBox();
        expect(rect!.y).toBe(0);
        expect(rect!.height).toBe(titlebar!.height);
        expect(await button.evaluate(el => {
          const bounds = el.getBoundingClientRect();
          return el.contains(document.elementFromPoint(bounds.x + bounds.width / 2, 0));
        })).toBe(true);
      }
    }
    await expect(page.getByText('Vrykell', { exact: true })).toHaveCount(0);

    const minimize = controls.locator('[data-testid="window-minimize"]');
    const close = controls.locator('[data-testid="window-close"]');
    await minimize.hover();
    await expect.poll(() => minimize.evaluate((element) => getComputedStyle(element).backgroundColor))
      .not.toBe('rgba(0, 0, 0, 0)');
    const neutralHover = await minimize.evaluate((element) => getComputedStyle(element).backgroundColor);
    await close.hover();
    await expect.poll(() => close.evaluate((element) => getComputedStyle(element).backgroundColor))
      .not.toBe('rgba(0, 0, 0, 0)');
    const dangerHover = await close.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(dangerHover).not.toBe(neutralHover);
    expect(await close.evaluate(element => element.contains(document.elementFromPoint(window.innerWidth - 1, 0)))).toBe(true);
    await page.screenshot({ path: test.info().outputPath('window-controls-flush.png'), clip: { x: page.viewportSize()!.width - 180, y: 0, width: 180, height: 70 } });

    await controls.locator('[data-testid="window-minimize"]').click();
    await controls.locator('[data-testid="window-maximize"]').click();
    await controls.locator('[data-testid="window-close"]').click();
  });

  test('files panel: clicking the files button shows directories and files', async ({ page }) => {
    // Click the "files" dock button to open the files panel.
    await page.locator('[data-dock-btn="files"]').click();
    await expect(page.getByText('Documents')).toBeVisible({ timeout: 3000 });
    await expect(page.getByText('notes.txt')).toBeVisible();
  });

  test('terminal area: xterm is mounted and the bottom input bar is present', async ({ page }) => {
    // The new pipeline starts in blockList, so xterm stays mounted but hidden; the bottom input bar should be visible.
    await expect(page.locator('.xterm')).toBeAttached();
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  });

  test('the bottom input bar supports switching to AI mode', async ({ page }) => {
    await page.getByRole('button', { name: '询问 AI', exact: true }).click();
    await expect(page.locator('[data-chat-composer]:visible')).toBeVisible();
    await page.locator('[data-dock-btn="chat"]').click();
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  });

  test('tab panel: open the panel, create a tab and switch', async ({ page }) => {
    // A new tab also enters blockList, so xterm is mounted but hidden.
    await expect(page.locator('.xterm')).toBeAttached();
    // Click the "tabs" dock button to open the tab panel.
    await ensureTabsOpen(page);
    // Clicking the panel's top new button opens the shell picker directly (no intermediate menu).
    await page.locator('[data-testid="tab-new-btn"]').click();
    await page.getByText('Zsh', { exact: true }).click();
    // Verify both tabs are visible in the panel.
    await expect(page.locator('[data-testid^="tab-row-"]')).toHaveCount(2);
    // Click the first tab to switch back.
    await page.getByText('终端').first().click();
    await expect(page.locator('[data-testid^="tab-row-"]')).toHaveCount(2);
  });

  test('document scrolling is locked: html/body overflow clips', async ({ page }) => {
    const check = () => page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      scrollY: window.scrollY,
      bodyOverflow: getComputedStyle(document.body).overflow,
      htmlOverflow: getComputedStyle(document.documentElement).overflow,
    }));

    // html/body overflow should be hidden.
    let s = await check();
    expect(s.htmlOverflow).toBe('hidden');
    expect(s.bodyOverflow).toBe('hidden');

    // The document cannot scroll initially.
    expect(s.scrollHeight).toBeLessThanOrEqual(s.innerHeight + 2);
    expect(s.scrollY).toBe(0);

    // Verify again after opening the panel.
    await ensureTabsOpen(page);
    await page.waitForTimeout(300);

    s = await check();
    expect(s.scrollY).toBe(0);
    expect(s.scrollHeight).toBeLessThanOrEqual(s.innerHeight + 2);
  });
});
