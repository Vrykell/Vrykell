import { test, expect } from '@playwright/test';
import { setupTauriMock, mockAnthropic } from './tauri-mock';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
});

test.describe('多标签工作区', () => {
  test('新建标签、切换、对话隔离', async ({ page }) => {
    await mockAnthropic(page, '回复一');
    await page.goto('/');

    // 切换到 AI 模式并发消息
    await page.getByRole('button', { name: 'cmd' }).click();
    const input = page.getByPlaceholder(/自然语言描述/);
    await input.fill('第一标签的问题');
    await input.press('Enter');
    await expect(page.getByText('回复一')).toBeVisible({ timeout: 10000 });

    // 用快捷键新建标签 2
    await page.keyboard.press('Meta+t');
    // 打开标签面板验证两个标签存在
    await page.locator('[data-dock-btn="tabs"]').click();
    await expect(page.locator('text=第一标签的问题').first()).toBeVisible();
    await expect(page.getByText('终端').first()).toBeVisible();

    // 切回标签 1
    await page.locator('text=第一标签的问题').first().click();
    await expect(page.getByText('回复一')).toBeVisible();
  });

  test('关闭标签后激活相邻标签', async ({ page }) => {
    await page.goto('/');
    // 等待应用加载完成
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
    // 用快捷键新建标签
    await page.keyboard.press('Meta+t');
    // 打开标签面板验证第二个标签存在
    await page.locator('[data-dock-btn="tabs"]').click();
    await expect(page.getByText('终端').first()).toBeVisible();
    // 快捷键关闭标签（会关闭当前激活的标签）
    await page.keyboard.press('Meta+w');
    // 标签面板中至少保留一个标签
    await expect(page.getByText('终端').first()).toBeVisible();
  });
});
