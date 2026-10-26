/**
 * Shape approvals e2e: a command the backend labelled with a shape is approved for the rest of the
 * session as that kind only — the same kind stops asking, another kind still does.
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock, mockAnthropic, mockAnthropicToolCall, armToolCall, approvalScopes, ensureChatSettingsOpen } from './tauri-mock';

/** Attach the session's terminal to the panel conversation, so run_command is available. */
async function attachTerminal(page: import('@playwright/test').Page) {
  await ensureChatSettingsOpen(page);
  await page.getByRole('combobox', { name: '选择执行终端' }).click();
  await page.getByRole('option').filter({ hasNotText: '仅讨论' }).first().click();
  await expect(page.getByRole('combobox', { name: '选择执行终端' })).not.toHaveText('仅讨论');
}

test.describe('shape approvals', () => {
  test('approves one kind of command for the session instead of the whole tool', async ({ page }) => {
    test.setTimeout(60_000);
    await mockAnthropic(page, '已记录');
    await mockAnthropicToolCall(page, 'run_command', { command: 'npm run build' }, 2);
    await setupTauriMock(page, {});
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
    await page.locator('[data-dock-btn="chat"]').click();
    const composer = page.getByTestId('ai-sidebar-content').getByPlaceholder(/自然语言描述/);
    await expect(composer).toBeVisible({ timeout: 3000 });
    await attachTerminal(page);

    // The card's options menu offers the narrowest grant, labelled with the backend's shape.
    await composer.fill('跑构建');
    await composer.press('Enter');
    await page.getByRole('button', { name: '审批选项' }).click();
    const shapeItem = page.getByRole('menuitem', { name: '本会话允许「npm run」' });
    await expect(shapeItem).toBeVisible({ timeout: 10000 });
    // The whole-tool approval is not offered next to it: it would be wider than what is shown.
    await expect(page.getByRole('menuitem', { name: '本对话允许', exact: true })).toHaveCount(0);

    await shapeItem.click();
    // The command runs and the approval was recorded as a shape approval.
    await expect(page.getByText('已记录')).toBeVisible({ timeout: 15000 });
    expect(await approvalScopes(page)).toEqual(['shape']);
    await expect(page.getByRole('button', { name: '审批选项' })).toHaveCount(0);

    // Another command of the same kind runs straight away, without a card ...
    await armToolCall(page, 1);
    await composer.fill('再构建一次');
    await composer.press('Enter');
    await expect(page.getByText('已记录')).toHaveCount(2, { timeout: 15000 });
    await expect(page.getByRole('button', { name: '审批选项' })).toHaveCount(0);

    // ... while a different kind asks again, because only the first one was approved.
    await armToolCall(page, 1);
    await page.evaluate(() => {
      const plan = (window as unknown as Record<string, { args?: { command?: string } } | undefined>).__AI_TOOL_CALL__;
      if (plan) plan.args = { command: 'npm publish' };
    });
    await composer.fill('发个包');
    await composer.press('Enter');
    await page.getByRole('button', { name: '审批选项' }).click();
    await expect(page.getByRole('menuitem', { name: '本会话允许「npm publish」' })).toBeVisible({ timeout: 15000 });
  });
});
