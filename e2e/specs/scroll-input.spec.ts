import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('[data-testid="terminal-view"]');
  await page.waitForTimeout(1500);
});

test('scroll position survives typing while scrolled up', async ({ page }) => {
  const view = page.locator('[data-testid="terminal-view"]');
  await view.click();

  // Fill the session with long output
  await page.keyboard.type('seq 200');
  await page.keyboard.press('Enter');
  await expect(view).toContainText('198', { timeout: 10000 });

  // Scroll up ~30 lines via mouse wheel
  await view.hover();
  await page.mouse.wheel(0, -16 * 30);
  await page.waitForTimeout(400);

  const before = await view.evaluate((el) => el.scrollTop);
  expect(before).toBeGreaterThan(0); // sanity: we actually scrolled up

  // Type a character (echo comes back over the PTY).  Regression guard for
  // the browser scrolling the hidden off-screen textarea into view on
  // input, which used to teleport the viewport.
  await page.keyboard.type('x');
  await page.waitForTimeout(600);

  const after = await view.evaluate((el) => el.scrollTop);
  expect(Math.abs(after - before)).toBeLessThanOrEqual(4);
});
