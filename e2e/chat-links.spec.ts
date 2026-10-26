/**
 * Transcript links e2e: a link in a reply must not navigate the app window — the allowed schemes
 * go to the system browser and the rest never becomes an anchor.
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock, mockAnthropic, openedUrls } from './tauri-mock';

test('a reply link leaves for the system browser instead of taking the window', async ({ page }) => {
  await mockAnthropic(page,
    '参考：[网页](https://example.com/doc) 以及 [本地](file:///C:/Windows/System32/calc.exe) 和 [协议](ms-msdt:/id)');
  await setupTauriMock(page, {});
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
  await page.locator('[data-dock-btn="chat"]').click();
  const composer = page.getByPlaceholder(/自然语言描述/);
  await expect(composer).toBeVisible({ timeout: 3000 });
  await composer.fill('给我个链接');
  await composer.press('Enter');

  const webLink = page.getByRole('link', { name: '网页' });
  await expect(webLink).toBeVisible({ timeout: 10000 });
  // Non-web schemes are not anchors at all: react-markdown clears them and the renderer falls back
  // to text, so there is nothing to click (the URL itself is gone, only the label remains).
  await expect(page.getByRole('link', { name: '本地' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '协议' })).toHaveCount(0);
  // The labels survive as plain text, so nothing is silently swallowed.
  await expect(page.locator('.md').last()).toContainText('本地');
  await expect(page.locator('.md').last()).toContainText('协议');

  const before = page.url();
  await webLink.click();

  // The window stayed on the app, and the URL went to the system browser.
  await expect.poll(() => openedUrls(page)).toEqual(['https://example.com/doc']);
  expect(page.url()).toBe(before);
  await expect(page.locator('[data-dock-btn="chat"]')).toHaveCount(1);
});
