import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

test.beforeEach(async ({ page }) => { await setupTauriMock(page); await page.goto('/'); });

test('shows only memory status and keeps retired features out of settings', async ({ page }) => {
  await gotoSetting(page, '记忆');
  await expect(page.getByTestId('memory-count-total')).toHaveText('1');
  await expect(page.getByTestId('memory-count-pending')).toHaveText('1');
  await expect(page.getByTestId('memory-count-active')).toHaveText('0');
  await expect(page.getByText('Old editor preference', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '记忆内容' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '子代理', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '定时任务', exact: true })).toHaveCount(0);
  await page.evaluate(() => { (window as unknown as { __MEMORY__: { status: string; expiresAt: number }[] }).__MEMORY__[0] = {
    ...(window as unknown as { __MEMORY__: { status: string; expiresAt: number }[] }).__MEMORY__[0]!, status: 'active', expiresAt: Date.now() + 10_000,
  }; });
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.getByTestId('memory-count-active')).toHaveText('1');
});

test('reports a load failure with retry and recovers without exposing records', async ({ page }) => {
  await page.evaluate(() => {
    const bridge = (window as unknown as { __TAURI_INTERNALS__: { invoke: (name: string, args?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const original = bridge.invoke;
    (window as unknown as { __MEMORY_FAILURE__: boolean }).__MEMORY_FAILURE__ = true;
    bridge.invoke = (name, args) => { if (name === 'memory_stats' && (window as unknown as { __MEMORY_FAILURE__: boolean }).__MEMORY_FAILURE__) return Promise.reject(new Error('Storage temporarily unavailable')); return original(name, args); };
  });
  await gotoSetting(page, '记忆');
  await expect(page.getByRole('alert')).toContainText('无法读取记忆状态');
  await page.evaluate(() => { (window as unknown as { __MEMORY_FAILURE__: boolean }).__MEMORY_FAILURE__ = false; });
  await page.getByRole('alert').getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByTestId('memory-count-total')).toHaveText('1');
});

for (const width of [640, 1440]) {
  test(`status stays readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await gotoSetting(page, '记忆');
    await expect(page.getByTestId('memory-count-pending')).toHaveText('1');
    await expect(page.getByRole('button', { name: '重新加载', exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`memory-${width}.png`), fullPage: true });
  });
}
