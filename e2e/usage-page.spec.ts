/**
 * Usage statistics page e2e: the conversation-settings entry, the metric cards, the trend chart,
 * the request log / providers / models tables, the filters and clearing.
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock, mockAnthropic, ensureChatSettingsOpen } from './tauri-mock';

/** Opens the usage page from the AI panel's conversation settings, reusing the panel when visible. */
async function openUsagePage(page: import('@playwright/test').Page) {
  const trigger = page.getByRole('button', { name: '会话设置', exact: true });
  if (!(await trigger.isVisible().catch(() => false))) await page.locator('[data-dock-btn="chat"]').click();
  await ensureChatSettingsOpen(page);
  await page.getByTestId('chat-usage-entry').click();
  await expect(page.getByTestId('usage-page')).toBeVisible();
}

/** The chat panel button toggles, so only press it when the composer is not on screen. */
async function ensureChatPanelOpen(page: import('@playwright/test').Page) {
  const composer = page.getByPlaceholder(/自然语言描述/);
  if (!(await composer.isVisible().catch(() => false))) await page.locator('[data-dock-btn="chat"]').click();
  await expect(composer).toBeVisible({ timeout: 3000 });
}

test.describe('usage statistics page', () => {
  test('opens from conversation settings and accounts for one turn', async ({ page }) => {
    await mockAnthropic(page, '已记录');
    // The default schedule seed is due at boot and would record a turn of its own.
    await setupTauriMock(page, { schedulesSeed: [] });
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });

    // The page opens as a workspace tab, empty until something runs.
    await openUsagePage(page);
    await expect(page.getByTestId('usage-page').getByText('用量统计')).toBeVisible();
    await expect(page.getByTestId('usage-total-requests')).toHaveText('0');
    await expect(page.getByTestId('usage-page').getByText('这段时间没有记录到用量。')).toBeVisible();
    await expect(page.getByTestId('usage-clear')).toBeDisabled();

    // One turn from the AI panel: the mocked stream reports prompt_tokens 10 / completion_tokens 5.
    await ensureChatPanelOpen(page);
    const input = page.getByPlaceholder(/自然语言描述/);
    await input.fill('统计一下用量');
    await input.press('Enter');
    await expect(page.getByText('已记录')).toBeVisible({ timeout: 10000 });

    await openUsagePage(page);
    await expect(page.getByTestId('usage-total-tokens')).toHaveText('15');
    await expect(page.getByTestId('usage-total-requests')).toHaveText('1');
    await expect(page.getByTestId('usage-fresh-input')).toHaveText('10');
    await expect(page.getByTestId('usage-trend-chart')).toBeVisible();

    const logRow = page.getByTestId('usage-log-row');
    await expect(logRow).toHaveCount(1);
    await expect(logRow).toHaveAttribute('data-model', 'gpt-4o-mini');
    await expect(logRow.getByRole('cell').nth(1)).toHaveText('openai-compatible');
    await expect(logRow.getByRole('cell').nth(3)).toHaveText('10');
    await expect(logRow.getByRole('cell').nth(4)).toHaveText('5');

    // The trend metric switch and the aggregate tables.
    await page.getByTestId('usage-metric-requests').click();
    await expect(page.getByTestId('usage-metric-requests')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('usage-tab-providers').click();
    await expect(page.getByTestId('usage-provider-row')).toHaveAttribute('data-provider', 'openai-compatible');
    await page.getByTestId('usage-tab-models').click();
    await expect(page.getByTestId('usage-model-row')).toHaveAttribute('data-model', 'gpt-4o-mini');
    await page.getByTestId('usage-tab-logs').click();
    await expect(page.getByTestId('usage-log-row')).toHaveCount(1);

    // Range and filter stay consistent.
    await page.getByTestId('usage-range').click();
    await page.getByRole('option', { name: '全部' }).click();
    await expect(page.getByTestId('usage-total-requests')).toHaveText('1');
    await page.getByTestId('usage-filter-model').click();
    await page.getByRole('option', { name: 'gpt-4o-mini' }).click();
    await expect(page.getByTestId('usage-total-tokens')).toHaveText('15');

    // Clearing returns the page to its empty state.
    await page.getByTestId('usage-clear').click();
    await expect(page.getByTestId('usage-total-requests')).toHaveText('0');
    await expect(page.getByRole('status')).toContainText('已清空用量数据');
  });
});
