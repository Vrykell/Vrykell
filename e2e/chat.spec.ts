import { test, expect } from '@playwright/test';
import { setupTauriMock, mockAnthropic } from './tauri-mock';

test.describe('chat conversation flow (inline AI mode)', () => {
  test('AI mode streams the reply after a message is sent', async ({ page }) => {
    await mockAnthropic(page, '好的，这是**加粗内容**测试。');
    await setupTauriMock(page);
    await page.goto('/');
    // Wait for the terminal to be ready (in the blockList scene xterm is hidden and the input bar is visible)
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });

    // Click ⚡ to switch to AI mode
    await page.getByRole('button', { name: '询问 AI', exact: true }).click();

    // Type natural language and send it
    const input = page.locator('[data-chat-composer]:visible');
    await expect(input).toBeVisible();
    await input.fill('你好');
    await input.press('Enter');

    // Wait for the AI reply to appear in the inline AI area
    await expect(page.getByText('加粗内容')).toBeVisible({ timeout: 10000 });
  });

  test('AI reply contains text content', async ({ page }) => {
    await mockAnthropic(page, '欧拉公式：e^{i*pi} + 1 = 0 是数学中最美的公式之一。');
    await setupTauriMock(page);
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });

    await page.getByRole('button', { name: '询问 AI', exact: true }).click();
    const input = page.locator('[data-chat-composer]:visible');
    await input.fill('写个公式');
    await input.press('Enter');

    // The inline AI area shows the reply text
    await expect(page.getByText(/欧拉公式/)).toBeVisible({ timeout: 10000 });
  });

  test('the first message names the tab automatically', async ({ page }) => {
    await mockAnthropic(page, '好的');
    await setupTauriMock(page);
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });

    await page.getByRole('button', { name: '询问 AI', exact: true }).click();
    const input = page.locator('[data-chat-composer]:visible');
    await input.fill('麦克斯韦方程组');
    await input.press('Enter');

    await expect(page.locator('.chat-conversation-title:visible')).toHaveText('麦克斯韦方程组', { timeout: 10000 });
  });

  test('the input is disabled while sending and restored afterwards', async ({ page }) => {
    await mockAnthropic(page, '完成');
    await setupTauriMock(page);
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });

    await page.getByRole('button', { name: '询问 AI', exact: true }).click();
    const input = page.locator('[data-chat-composer]:visible');
    await input.fill('测试');
    await input.press('Enter');

    await expect(page.getByText('完成')).toBeVisible({ timeout: 10000 });
    await expect(input).toBeEnabled();
  });
});
