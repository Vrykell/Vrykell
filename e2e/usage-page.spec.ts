/**
 * Usage statistics page e2e: the conversation-settings entry, the metric cards, the trend chart,
 * the request log / providers / models tables, the filters and clearing — plus the view an ACP
 * server gets when it is the selected source.
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock, mockAnthropic, ensureChatSettingsOpen, emitAcpSession, acpUpdate } from './tauri-mock';

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

    // 蓝色圆角柱 + 悬停显示该桶的完整时间与数值（命中区是整列）
    await expect(page.getByTestId('usage-trend-bar').first()).toHaveAttribute('rx', '3');
    await page.getByTestId('usage-trend-slot-0').hover();
    const tooltip = page.getByTestId('usage-trend-tooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(/^\d{4}\/\d{2}\/\d{2} \d{2}:00/);
    await expect(tooltip).toContainText('Tokens');
    await expect(tooltip).toContainText('15 tokens');
    // 高亮只覆盖这一根柱：宽度跟着柱走，不会铺满整个时间槽
    const laneWidth = Number(await page.getByTestId('usage-trend-hover').getAttribute('width'));
    expect(laneWidth).toBeLessThan(80);

    // 来源选择条：默认「全部」，点本机来源后数据不变；本机来源 chip 用应用图标且真实加载
    await expect(page.getByTestId('usage-source-all')).toHaveAttribute('aria-pressed', 'true');
    const appIcon = page.getByTestId('usage-source-vrykell').locator('img');
    await expect(appIcon).toHaveAttribute('src', '/app-icon.svg');
    // 资源真实可达：图片加载完成后 naturalWidth 才会大于 0
    await expect.poll(() => appIcon.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await page.getByTestId('usage-source-vrykell').click();
    await expect(page.getByTestId('usage-source-vrykell')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('usage-total-requests')).toHaveText('1');
    await page.getByTestId('usage-source-all').click();
    await expect(page.getByTestId('usage-source-all')).toHaveAttribute('aria-pressed', 'true');

    // 刷新按钮：重读存储并给出刷新时间
    await expect(page.getByTestId('usage-refreshed-at')).toHaveCount(0);
    await page.getByTestId('usage-refresh').click();
    await expect(page.getByTestId('usage-refreshed-at')).toContainText('刷新于');
    await expect(page.getByTestId('usage-total-tokens')).toHaveText('15');

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
    await page.getByRole('option', { name: '全部时间' }).click();
    await expect(page.getByTestId('usage-total-requests')).toHaveText('1');
    await page.getByTestId('usage-filter-model').click();
    await page.getByRole('option', { name: 'gpt-4o-mini' }).click();
    await expect(page.getByTestId('usage-total-tokens')).toHaveText('15');

    // Clearing returns the page to its empty state.
    await page.getByTestId('usage-clear').click();
    await expect(page.getByTestId('usage-total-requests')).toHaveText('0');
    await expect(page.getByRole('status')).toContainText('已清空用量数据');
  });

  test('shows only the ACP numbers when a server is the selected source', async ({ page }) => {
    await setupTauriMock(page, { schedulesSeed: [] });
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });

    // Connect the configured server, then let it report a session the way the backend forwards it.
    await page.keyboard.press('Control+,');
    await page.getByText('ACP', { exact: true }).first().click();
    await page.getByTestId('harness-connect-0').click();
    await expect(page.getByTestId('harness-send')).toBeVisible({ timeout: 10000 });
    const session = 'sess_e2e';
    await emitAcpSession(page, acpUpdate(session, {
      sessionUpdate: 'tool_call', toolCallId: 'call_1', title: 'Run the tests', status: 'pending',
    }));
    await emitAcpSession(page, acpUpdate(session, {
      sessionUpdate: 'usage_update', used: 12_000, size: 200_000, cost: { amount: 0.0042, currency: 'USD' },
    }));
    await emitAcpSession(page, { sessionId: session, kind: 'stop', payload: { stopReason: 'end_turn' } });

    await openUsagePage(page);
    await page.getByTestId('usage-source-Fake ACP').click();

    // 只显示协议带回来的数字：轮数、工具调用、上下文占用、累计费用
    await expect(page.getByTestId('usage-acp-turns')).toHaveText('1');
    await expect(page.getByTestId('usage-acp-tool-calls')).toHaveText('1');
    await expect(page.getByTestId('usage-acp-context')).toHaveText('1.2万/20万');
    await expect(page.getByTestId('usage-acp-cost')).toHaveText('0.0042');
    await expect(page.getByTestId('usage-acp-updated')).toContainText('最近更新');
    // token 卡片、趋势图、token 表格与只作用于 token 记录的筛选器都不出现
    await expect(page.getByTestId('usage-metrics')).toHaveCount(0);
    await expect(page.getByTestId('usage-trend-chart')).toHaveCount(0);
    await expect(page.getByTestId('usage-tab-logs')).toHaveCount(0);
    await expect(page.getByTestId('usage-filter-provider')).toHaveCount(0);
    await expect(page.getByTestId('usage-range')).toHaveCount(0);
    await expect(page.getByTestId('usage-record-count')).toHaveCount(0);

    // 回到全部来源：token 视图回来，ACP 在记录卡片里占一个页签（不再是独立卡片）
    await page.getByTestId('usage-source-all').click();
    await expect(page.getByTestId('usage-metrics')).toBeVisible();
    await expect(page.getByTestId('usage-acp-row')).toHaveCount(0);
    await page.getByTestId('usage-tab-acp').click();
    const acpRow = page.getByTestId('usage-acp-row');
    await expect(acpRow).toHaveAttribute('data-source', 'Fake ACP');
    await expect(acpRow).toContainText('1.2万/20万');
    await expect(acpRow).toContainText('0.0042 USD');
  });
});
