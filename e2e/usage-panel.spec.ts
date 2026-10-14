/**
 * Usage panel e2e: sidebar entry, empty state, provider-reported tokens landing in the
 * panel, range switching and clearing.
 *
 * Sending a message can take over the right side (the chat panel replaces an open sidebar
 * panel), so the panel is reopened after the turn before the numbers are asserted.
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock, mockAnthropic } from './tauri-mock';

test.describe('usage panel', () => {
  test('records the tokens of one turn and opens from the sidebar', async ({ page }) => {
    await mockAnthropic(page, '已记录');
    // The default schedule seed is due at boot and would record a turn of its own.
    await setupTauriMock(page, { schedulesSeed: [] });
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });

    // Sidebar button opens the panel: empty state, nothing to clear yet.
    const usageButton = page.locator('[data-dock-btn="usage"]');
    await usageButton.click();
    await expect(page.getByTestId('usage-panel')).toBeVisible();
    await expect(page.getByTestId('usage-empty')).toBeVisible();
    await expect(page.getByTestId('usage-clear')).toBeDisabled();

    // One turn: the mocked stream reports prompt_tokens 10 / completion_tokens 5.
    await page.getByRole('button', { name: '询问 AI', exact: true }).click();
    const input = page.getByPlaceholder(/自然语言描述/);
    await input.fill('统计一下用量');
    await input.press('Enter');
    await expect(page.getByText('已记录')).toBeVisible({ timeout: 10000 });

    // Reopen the panel: 1 request, 10 input tokens, 5 output tokens.
    if (!(await page.getByTestId('usage-turns').isVisible().catch(() => false))) await usageButton.click();
    await expect(page.getByTestId('usage-turns')).toHaveText('1');
    await expect(page.getByTestId('usage-input-tokens')).toHaveText('10');
    await expect(page.getByTestId('usage-output-tokens')).toHaveText('5');
    await expect(page.getByTestId('usage-total-tokens')).toHaveText('15');
    await expect(page.getByTestId('usage-model-row')).toContainText('gpt-4o-mini');
    await expect(page.getByTestId('usage-recent-row')).toHaveCount(1);

    // Switching the range keeps the numbers of the current window.
    await page.getByTestId('usage-range').click();
    await page.getByRole('option', { name: '全部' }).click();
    await expect(page.getByTestId('usage-turns')).toHaveText('1');

    // Clearing returns to the empty state.
    await page.getByTestId('usage-clear').click();
    await expect(page.getByTestId('usage-empty')).toBeVisible();
    await expect(page.getByRole('status')).toContainText('已清空用量数据');
  });
});
