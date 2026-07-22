import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('[data-testid="terminal-view"]');
});

test('auto-creates a session and renders a prompt', async ({ page }) => {
  await expect(page.locator('[data-testid="terminal-tabs"]')).toBeVisible();
  await expect(page.locator('[data-testid="terminal-view"]')).toBeVisible();
});

test('typing echoes into the terminal', async ({ page }) => {
  const view = page.locator('[data-testid="terminal-view"]');
  await view.click();
  await page.keyboard.type('echo playwright');
  await page.keyboard.press('Enter');
  await expect(view).toContainText('playwright', { timeout: 8000 });
});

test('creates a new tab and switches active session', async ({ page }) => {
  await expect(page.locator('[data-testid^="session-tab-"]')).toHaveCount(1);
  await page.getByTestId('new-tab-btn').click();
  await expect(page.locator('[data-testid^="session-tab-"]')).toHaveCount(2);
});
