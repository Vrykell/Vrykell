import { test, expect } from '@playwright/test';
import { clipboardText, ptyWrites, setupTauriMock } from './tauri-mock';

test.describe('命令块操作全链路', () => {
  test('运行命令后复制命令和输出，并通过同一面板重新运行', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');

    const input = page.getByPlaceholder(/输入命令/);
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill('echo linux-block-action');
    await input.press('Enter');

    const block = page.locator('[data-testid^="command-block-"]').filter({ hasText: 'echo linux-block-action' }).first();
    await expect(block).toBeVisible({ timeout: 5000 });
    await expect(block).toContainText('linux-block-action');

    await block.hover();
    await page.getByTitle('复制命令').click();
    await expect.poll(() => clipboardText(page)).toBe('echo linux-block-action');
    await expect(block.getByTestId('copy-command-success')).toBeVisible();
    await expect(page.getByText('已复制', { exact: true })).toHaveCount(0);

    await block.hover();
    await page.getByTitle('复制输出').click();
    await expect.poll(() => clipboardText(page)).toBe('linux-block-action');
    await expect(block.getByTestId('copy-output-success')).toBeVisible();

    const writesBefore = (await ptyWrites(page)).length;
    await block.hover();
    await page.getByTitle('重新运行').click();
    await expect.poll(async () => (await ptyWrites(page)).slice(writesBefore)).toContain('echo linux-block-action\n');
    await expect(block).toContainText('linux-block-action');
  });

  test('通过更多菜单执行复制、书签和清除，操作作用于当前面板', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');

    const input = page.getByPlaceholder(/输入命令/);
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill('echo menu-action');
    await input.press('Enter');
    const block = page.locator('[data-testid^="command-block-"]').filter({ hasText: 'echo menu-action' }).first();
    await expect(block).toBeVisible({ timeout: 5000 });

    await block.hover();
    await page.getByTitle('更多操作').click();
    const menu = page.getByRole('menu', { name: '命令块操作' });
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: '复制输出' }).click();
    await expect.poll(() => clipboardText(page)).toBe('menu-action');

    await block.hover();
    await page.getByTitle('更多操作').click();
    await page.getByRole('menuitem', { name: '添加书签' }).click();
    await block.hover();
    await expect(page.getByTitle('取消书签')).toBeVisible();

    await block.hover();
    await page.getByTitle('更多操作').click();
    await page.getByRole('menuitem', { name: '清除所有块' }).click();
    await expect(block).toHaveCount(0);
  });
});
