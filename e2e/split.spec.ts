import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { focusedPane, hoverPlacementZone, pickPlacementZone } from './placement';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
});

/**
 * The placement overlay picks the half-screen under the pointer: hovering renders only that
 * drop zone's grey preview (with its direction and action hint) and a click confirms it.
 * Hover coordinates come from the pane geometry (placement.ts); the grid of every drop zone
 * is no longer rendered.
 */
test.describe('window splitting (binary split tree + placement selection)', () => {
  test('horizontal panes retain usable width after divider dragging and sidebar resize', async ({ page }) => {
    await page.keyboard.press('Meta+d');
    await pickPlacementZone(page, focusedPane(page), 'right');
    const divider = page.getByTestId('terminal-divider-row');
    const rect = (await divider.boundingBox())!;
    const main = (await page.locator('main').boundingBox())!;
    await page.mouse.move(rect.x + rect.width / 2, rect.y + 100);
    await page.mouse.down(); await page.mouse.move(main.x + 5, rect.y + 100, { steps: 8 }); await page.mouse.up();
    const checkWidths = async () => {
      await expect.poll(() => page.locator('.terminal-pane:visible').evaluateAll(elements =>
        Math.min(...elements.map(element => element.getBoundingClientRect().width)))).toBeGreaterThanOrEqual(359);
      const widths = await page.locator('.terminal-pane:visible').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().width));
      expect(widths).toHaveLength(2);
      for (const width of widths) expect(width).toBeGreaterThanOrEqual(359);
    };
    await checkWidths();
    await page.locator('[data-dock-btn="chat"]').click();
    await checkWidths();
    for (const button of await page.getByRole('button', { name: '询问 AI', exact: true }).all()) await expect(button).toBeInViewport();
    await page.setViewportSize({ width: 900, height: 800 });
    await checkWidths();
  });
  test('⌘D opens placement selection and clicking the right half splits into two terminals', async ({ page }) => {
    await page.keyboard.press('Meta+d');
    // 1 terminal → 4 half-screen drop zones; hovering the right half shows only that grey preview
    const point = await hoverPlacementZone(page, focusedPane(page), 'right');
    const preview = page.getByTestId('placement-zone-1');
    await expect(preview).toBeVisible();
    await expect(preview).toHaveText('点击此处分裂终端');
    await page.mouse.click(point.x, point.y);
    await expect(page.locator('.terminal-pane:visible')).toHaveCount(2);
    await expect(page.getByPlaceholder(/输入命令/)).toHaveCount(2);

    const sizes = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.terminal-pane')).filter(el => el.getBoundingClientRect().width > 0).map((el) => {
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height };
      }),
    );
    for (const s of sizes) {
      expect(s.w).toBeGreaterThan(100);
      expect(s.h).toBeGreaterThan(100);
    }
  });

  test('a new terminal (new window) does not join the current window layout automatically', async ({ page }) => {
    await page.keyboard.press('Meta+d');
    await pickPlacementZone(page, focusedPane(page), 'right');
    await expect(page.locator('.terminal-pane:visible')).toHaveCount(2);
    await page.keyboard.press('Meta+t');
    // Old tabs stay alive (display:none rather than unmounted), so count visible panes only
    await expect(page.locator('.terminal-pane:visible')).toHaveCount(1);
  });

  test('⌘] / ⌘[ switch focus between terminals in the current window', async ({ page }) => {
    await page.keyboard.press('Meta+d');
    await pickPlacementZone(page, focusedPane(page), 'right');
    const panes = page.locator('.terminal-pane:visible');
    await expect(panes).toHaveCount(2);
    await expect(panes.nth(1)).toHaveAttribute('data-focused', 'true');
    await expect(panes.nth(0)).toHaveAttribute('data-focused', 'false');

    await page.keyboard.press('Meta+]');
    await expect(panes.nth(0)).toHaveAttribute('data-focused', 'true');
    await page.keyboard.press('Meta+[');
    await expect(panes.nth(1)).toHaveAttribute('data-focused', 'true');
  });

  test('⌥⌘D picks a type and then a placement to split out a mixed terminal', async ({ page }) => {
    await page.keyboard.press('Meta+Alt+d');
    await expect(page.getByRole('dialog', { name: '新建标签页' })).toBeVisible();
    await page.getByTestId('new-tab-option-ssh:ssh-1').click();
    // Enter placement selection
    await expect(page.getByTestId('placement-overlay')).toBeVisible();
    await pickPlacementZone(page, focusedPane(page), 'right');
    await expect(page.locator('.terminal-pane:visible')).toHaveCount(2);
  });

  test('splitting stops after four terminals', async ({ page }) => {
    const panes = page.locator('.terminal-pane:visible');
    // 1 → 2: right half; 2 → 3: top half of the left pane; 3 → 4: top half of the right pane
    await page.keyboard.press('Meta+d');
    await pickPlacementZone(page, focusedPane(page), 'right');
    await expect(panes).toHaveCount(2);
    await page.keyboard.press('Meta+d');
    await pickPlacementZone(page, panes.nth(0), 'top');
    await expect(panes).toHaveCount(3);
    await page.keyboard.press('Meta+d');
    await pickPlacementZone(page, panes.nth(2), 'top');
    await expect(panes).toHaveCount(4);
    // Split again: the deeper leaves have no drop zones, so a hint appears and four panes remain
    await page.keyboard.press('Meta+d');
    await expect(page.getByText('最多 4 个终端')).toBeVisible();
    await expect(page.locator('[data-testid^="placement-zone-"]')).toHaveCount(0);
    await expect(panes).toHaveCount(4);
  });
});
