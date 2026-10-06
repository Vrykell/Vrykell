import { test, expect } from '@playwright/test';
import { clipboardText, ptyWrites, setupTauriMock } from './tauri-mock';

test.describe('命令块操作全链路', () => {
  test('已完成命令的悬停操作按钮保持统一紧凑尺寸', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    const input = page.getByPlaceholder(/输入命令/);
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill('echo compact-toolbar');
    await input.press('Enter');

    const block = page.locator('[data-testid^="command-block-"]').filter({ hasText: 'echo compact-toolbar' }).first();
    await expect(block).toBeVisible({ timeout: 5000 });
    await block.hover();
    const titles = ['AI 解释', '重新运行', '复制命令', '复制输出', '更多操作'];
    const bounds: Array<{ x: number; width: number }> = [];
    for (const title of titles) {
      const button = block.locator(`[data-tip="${title}"]`);
      await expect(button).toHaveCSS('width', '28px');
      await expect(button).toHaveCSS('height', '28px');
      await expect(button.locator('svg')).toHaveCSS('width', '14px');
      const box = await button.boundingBox();
      expect(box).not.toBeNull();
      bounds.push({ x: box!.x, width: box!.width });
    }
    for (let index = 1; index < bounds.length; index += 1) {
      const previous = bounds[index - 1]!;
      const current = bounds[index]!;
      expect(current.x - previous.x - previous.width).toBeLessThanOrEqual(1);
    }
    const collapse = block.locator('[data-tip="折叠"]');
    await expect(collapse).toHaveCSS('width', '28px');
    await expect(collapse.locator('svg')).toHaveCSS('width', '12px');
    await collapse.click();
    await expect(block.locator('[data-tip="展开"]').locator('svg')).toHaveCSS('width', '12px');
    await block.locator('[data-tip="展开"]').click();
    await block.hover();
    await block.screenshot({ path: test.info().outputPath('compact-toolbar.png') });
  });

  test('命令块右键菜单出现在鼠标点击位置', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    const input = page.getByPlaceholder(/输入命令/);
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill('echo context-menu-position');
    await input.press('Enter');

    const block = page.locator('[data-testid^="command-block-"]').filter({ hasText: 'echo context-menu-position' }).first();
    await expect(block).toBeVisible({ timeout: 5000 });
    await block.evaluate((element) => {
      element.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 180,
        clientY: 160,
      }));
    });

    const menu = page.getByRole('menu', { name: '命令块操作' });
    await expect(menu).toBeVisible();
    const bounds = await menu.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBe(180);
    expect(bounds!.y).toBe(160);
  });

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
    await page.locator('[data-tip="复制命令"]').click();
    await expect.poll(() => clipboardText(page)).toBe('echo linux-block-action');
    await expect(block.getByTestId('copy-command-success')).toBeVisible();
    await expect(page.getByText('已复制', { exact: true })).toHaveCount(0);

    await block.hover();
    await page.locator('[data-tip="复制输出"]').click();
    await expect.poll(() => clipboardText(page)).toBe('linux-block-action');
    await expect(block.getByTestId('copy-output-success')).toBeVisible();

    const writesBefore = (await ptyWrites(page)).length;
    await block.hover();
    await page.locator('[data-tip="重新运行"]').click();
    await expect.poll(async () => (await ptyWrites(page)).slice(writesBefore)).toContain('echo linux-block-action\n');
    await expect(block).toContainText('linux-block-action');
  });

  test('通过更多菜单复制输出并清除当前面板的命令块', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');

    const input = page.getByPlaceholder(/输入命令/);
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill('echo menu-action');
    await input.press('Enter');
    const block = page.locator('[data-testid^="command-block-"]').filter({ hasText: 'echo menu-action' }).first();
    await expect(block).toBeVisible({ timeout: 5000 });

    await block.hover();
    await page.locator('[data-tip="更多操作"]').click();
    const menu = page.getByRole('menu', { name: '命令块操作' });
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: '复制输出' }).click();
    await expect.poll(() => clipboardText(page)).toBe('menu-action');

    await block.hover();
    await page.locator('[data-tip="更多操作"]').click();
    await page.getByRole('menuitem', { name: '清除所有块' }).click();
    await expect(block).toHaveCount(0);
  });
});
