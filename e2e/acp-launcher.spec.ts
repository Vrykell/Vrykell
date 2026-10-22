/**
 * ACP launcher e2e: the workspace entry opens the singleton AI page and its server picker.
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test('the sidebar ACP button opens the singleton workspace with its server picker', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await page.waitForTimeout(600);
  await expect(page.getByTestId('tab-acp-btn')).toBeVisible();
  await page.getByTestId('tab-acp-btn').click();
  await expect(page.getByTestId('harness-workspace')).toBeVisible();
  await page.getByTestId('workspace-area-ai').click();
  await expect(page.getByTestId('workspace-area-ai')).toHaveCount(1);
  await page.getByTestId('harness-add-session').click();
  await expect(page.getByTestId('acp-launcher')).toBeVisible();
});

test('picking a server opens its session tab and closes the panel', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await page.waitForTimeout(600);
  await page.getByTestId('workspace-area-ai').click();
  await page.getByTestId('harness-add-session').click();
  await page.getByTestId('acp-launcher-Fake ACP').click();
  await expect(page.getByTestId('acp-launcher')).toHaveCount(0);
  await expect(page.getByTestId('harness-page')).toBeVisible();
});
