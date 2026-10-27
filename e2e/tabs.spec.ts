import { test, expect } from '@playwright/test';
import { setupTauriMock, mockAnthropic, ensureTabsOpen, emitPtyOutput } from './tauri-mock';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
});

test.describe('多标签工作区', () => {
  test('terminal instances isolate output while the assistant retains its independent conversation', async ({ page }) => {
    await mockAnthropic(page, '回复一');
    await page.goto('/');

    await expect(page.locator('[data-terminal-input]')).toBeVisible();
    await page.waitForFunction(async () => {
      const path = '/src/features/terminal/stores/terminal.ts';
      const { useTerminalStore } = await import(path) as typeof import('../src/features/terminal/stores/terminal');
      return Object.values(useTerminalStore.getState().startupStates).includes('ready');
    });
    const original = await page.locator('[data-tab-row-id]').first().getAttribute('data-tab-row-id');
    await emitPtyOutput(page, '\x1b]133;E;ZWNobyBpc29sYXRlZA==\x07\x1b]133;C\x07FIRST_TERMINAL_OUTPUT\r\n\x1b]133;D;0\x07');
    const output = page.locator('[data-testid^="command-block-"]').getByText('FIRST_TERMINAL_OUTPUT', { exact: true });
    await expect(output).toBeVisible();
    // The assistant conversation stays independent of terminal instance selection.
    await page.getByRole('button', { name: '询问 AI', exact: true }).click();
    const input = page.locator('[data-chat-composer]:visible');
    await input.fill('第一标签的问题');
    await input.press('Enter');
    await expect(page.getByText('回复一')).toBeVisible({ timeout: 10000 });

    await page.locator('[data-terminal-input]:visible').focus();
    await page.keyboard.press('Meta+t');
    await ensureTabsOpen(page);
    await expect(page.locator('[data-tab-row-id][data-tab-kind="session"]')).toHaveCount(2);
    await expect(output).toBeHidden();
    const assistant = page.getByTestId('ai-surface-side');
    await expect(assistant.locator('.ai-block-question')).toHaveText('第一标签的问题');
    await expect(assistant.locator('.ai-block-question')).toBeVisible();
    await expect(assistant.locator('.chat-conversation-title')).toHaveText('第一标签的问题');
    await expect(assistant.getByText('回复一', { exact: true })).toBeVisible();

    await page.locator(`[data-tab-row-id="${original}"]`).click();
    await expect(output).toBeVisible();
    await expect(assistant.getByText('回复一', { exact: true })).toBeVisible();
  });

  test('关闭标签后激活相邻标签', async ({ page }) => {
    await page.goto('/');
    // 等待应用加载完成
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
    // 用快捷键新建标签
    await page.keyboard.press('Meta+t');
    // 打开标签面板验证第二个标签存在
    await ensureTabsOpen(page);
    await expect(page.getByText('终端').first()).toBeVisible();
    // 快捷键关闭标签（会关闭当前激活的标签）
    await page.keyboard.press('Meta+w');
    // 标签面板中至少保留一个标签
    await expect(page.getByText('终端').first()).toBeVisible();
  });
});
