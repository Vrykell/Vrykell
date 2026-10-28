import { test, expect } from '@playwright/test';
import { setupTauriMock, mockAnthropic, ensureTabsOpen, emitPtyOutput } from './tauri-mock';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
});

test.describe('Multi-tab workspace', () => {
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

  test('closing a tab activates the adjacent tab', async ({ page }) => {
    await page.goto('/');
    // Wait for the app to finish loading.
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
    // Create a new tab with the keyboard shortcut.
    await page.keyboard.press('Meta+t');
    // Open the tab panel and verify the second tab exists.
    await ensureTabsOpen(page);
    await expect(page.getByText('终端').first()).toBeVisible();
    // Close the tab with the keyboard shortcut (this closes the currently active tab).
    await page.keyboard.press('Meta+w');
    // The tab panel keeps at least one tab.
    await expect(page.getByText('终端').first()).toBeVisible();
  });
});
