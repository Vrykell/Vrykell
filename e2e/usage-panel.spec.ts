/**
 * Usage panel e2e: the conversation-settings entry, the empty state, provider-reported
 * tokens landing in the panel, range switching and clearing.
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock, mockAnthropic, ensureChatSettingsOpen } from './tauri-mock';

/** Opens the AI panel's conversation settings, reusing the panel when it is already visible. */
async function openConversationSettings(page: import('@playwright/test').Page) {
  const trigger = page.getByRole('button', { name: '会话设置', exact: true });
  // The activity-bar button toggles the panel, so only press it when the chat panel is hidden.
  if (!(await trigger.isVisible().catch(() => false))) await page.locator('[data-dock-btn="chat"]').click();
  await ensureChatSettingsOpen(page);
}

async function openUsagePanel(page: import('@playwright/test').Page) {
  await openConversationSettings(page);
  await page.getByTestId('chat-usage-entry').click();
  await expect(page.getByTestId('usage-panel')).toBeVisible();
}

test.describe('usage panel', () => {
  test('opens from conversation settings and records the tokens of one turn', async ({ page }) => {
    await mockAnthropic(page, '已记录');
    // The default schedule seed is due at boot and would record a turn of its own.
    await setupTauriMock(page, { schedulesSeed: [] });
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });

    // Conversation settings → Usage: empty state, nothing to clear yet.
    await openUsagePanel(page);
    await expect(page.getByTestId('usage-empty')).toBeVisible();
    await expect(page.getByTestId('usage-clear')).toBeDisabled();

    // One turn from the AI panel: the mocked stream reports prompt_tokens 10 / completion_tokens 5.
    await page.locator('[data-dock-btn="chat"]').click();
    const input = page.getByPlaceholder(/自然语言描述/);
    await expect(input).toBeVisible({ timeout: 3000 });
    await input.fill('统计一下用量');
    await input.press('Enter');
    await expect(page.getByText('已记录')).toBeVisible({ timeout: 10000 });

    // Back to the panel through the same entry: 1 request, 10 input tokens, 5 output tokens.
    await openUsagePanel(page);
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
