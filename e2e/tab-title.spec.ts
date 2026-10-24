import { test, expect } from '@playwright/test';
import { setupTauriMock, emitPtyOutput, ensureTabsOpen } from './tauri-mock';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
});

test.describe('终端标题', () => {
  test('运行中程序设置的窗口标题显示在标题栏，程序结束后还原', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });

    const title = page.getByTestId('tab-row-t1').getByRole('tab');
    await expect(title).toHaveText('终端');

    // Start a foreground command: a title set now belongs to the program, not the shell.
    await emitPtyOutput(page, '\x1b]133;A\x07\x1b]133;C\x07');
    await emitPtyOutput(page, '\x1b]2;⠋ Claude\x07');
    await expect(title).toHaveText('⠋ Claude');

    // The spinner redraws often; a repeated title keeps showing.
    await emitPtyOutput(page, '\x1b]2;⠋ Claude\x07');
    await expect(title).toHaveText('⠋ Claude');

    // Ending the command returns to the generated title.
    await emitPtyOutput(page, '\x1b]133;D;0\x07\x1b]133;A\x07');
    await expect(title).toHaveText('终端');

    // A title set at the shell prompt belongs to the shell and is ignored.
    await emitPtyOutput(page, '\x1b]2;shell-cwd\x07');
    await expect(title).toHaveText('终端');
  });

  test('复制的会话仍响应前台程序设置的窗口标题', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
    await ensureTabsOpen(page);

    const rows = page.locator('[data-testid^="tab-row-"]');
    await rows.first().click({ button: 'right' });
    await expect(page.getByRole('menu', { name: '操作菜单' })).toBeVisible();
    await page.getByText('复制会话', { exact: true }).click();

    await expect(rows).toHaveCount(2);
    await expect(rows.last().getByRole('tab')).toHaveText('终端 副本');
    await emitPtyOutput(page, '\x1b]133;A\x07\x1b]133;C\x07');
    await emitPtyOutput(page, '\x1b]2;copied process\x07');
    await expect(rows.last().getByRole('tab')).toHaveText('copied process');
  });
});
