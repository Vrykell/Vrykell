/**
 * ACP launcher e2e — the sidebar button opens the panel, and the panel starts a session.
 *
 * This covers the wiring that a unit test cannot: the tab bar imports the launcher and renders it,
 * which is exactly where a module cycle shows up as a blank page.
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test('the sidebar ACP button reuses a singleton workspace with an inline server picker', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await page.waitForTimeout(600);
  await expect(page.getByTestId('tab-acp-btn')).toBeVisible();
  await page.getByTestId('tab-acp-btn').click();
  await expect(page.getByTestId('acp-launcher')).toBeVisible();
  await expect(page.getByTestId('harness-workspace')).toBeVisible();
  await page.getByTestId('tab-acp-btn').click();
  await expect(page.locator('[data-tab-kind="harness"]')).toHaveCount(1);
});

test('picking a server opens its session tab and closes the panel', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await page.waitForTimeout(600);
  await page.getByTestId('tab-acp-btn').click();
  await page.getByTestId('acp-launcher-Fake ACP').click();
  await expect(page.getByTestId('acp-launcher')).toHaveCount(0);
  await expect(page.getByTestId('harness-page')).toBeVisible();
});
