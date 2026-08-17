import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
});

test.describe('全局快捷键', () => {
  test('Cmd+T 新建标签，Cmd+W 关闭标签', async ({ page }) => {
    // 打开标签面板
    await page.locator('[data-dock-btn="tabs"]').click();
    // 应有至少一个标签
    await expect(page.locator('[data-testid^="tab-row-"]')).toHaveCount(1);
    // 新建标签
    await page.keyboard.press('Meta+t');
    // 面板中应有两个标签
    await expect(page.locator('[data-testid^="tab-row-"]')).toHaveCount(2);
    // 面板内点击顶部新建按钮 → 直接弹出类型选择弹窗（无中间菜单），选 zsh
    await page.locator('[data-testid="tab-new-btn"]').click();
    await page.getByText('Zsh', { exact: true }).click();
    await expect(page.locator('[data-testid^="tab-row-"]')).toHaveCount(3);
    // Cmd+W 关闭当前标签
    await page.keyboard.press('Meta+w');
    await expect(page.locator('[data-testid^="tab-row-"]')).toHaveCount(2);
  });

  test('Cmd+数字切换标签', async ({ page }) => {
    await page.keyboard.press('Meta+t');
    await page.keyboard.press('Meta+t');
    // 打开标签面板验证多个标签存在
    await page.locator('[data-dock-btn="tabs"]').click();
    await expect(page.getByText('终端').first()).toBeVisible();
    // 切换回第一个标签（验证 activate 生效）
    await page.keyboard.press('Meta+1');
    // 确认第一个标签仍可见
    await expect(page.getByText('终端').first()).toBeVisible();
  });

  test('Cmd+F 打开全局搜索并聚焦', async ({ page }) => {
    await page.keyboard.press('Meta+f');
    const searchInput = page.getByPlaceholder(/搜索文件/);
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(searchInput).not.toBeVisible();
  });

  test('Cmd+, 打开设置页', async ({ page }) => {
    await page.keyboard.press('Meta+,');
    await expect(page.getByText('服务地址 (Base URL)')).toBeVisible();
  });

  test('Cmd+P 打开命令面板', async ({ page }) => {
    await page.keyboard.press('Meta+p');
    await expect(page.getByPlaceholder('搜索命令…')).toBeVisible({ timeout: 3000 });
    // 第一次 Escape 清空输入，第二次 Escape 关闭面板
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await expect(page.getByPlaceholder('搜索命令…')).not.toBeVisible({ timeout: 3000 });
  });

  test('Cmd+= 增大字号', async ({ page }) => {
    await page.keyboard.press('Meta+=');
    // 字号应增大（检查 style 属性被设置）
    const size = await page.evaluate(() => document.documentElement.style.fontSize);
    expect(size).toBeTruthy();
    // 重置
    await page.keyboard.press('Meta+0');
  });

  test('点击 TopDock 搜索触发器打开居中搜索窗', async ({ page }) => {
    const trigger = page.getByTestId('global-search-trigger');
    await expect(trigger).toBeVisible({ timeout: 3000 });
    // 点击触发器 → 打开居中搜索窗
    await trigger.click();
    const searchInput = page.getByPlaceholder(/搜索文件/);
    await expect(searchInput).toBeVisible({ timeout: 3000 });
    // 输入搜索词 → 触发搜索
    await searchInput.fill('test');
    await page.waitForTimeout(1000);
    // Escape 关闭弹窗
    await page.keyboard.press('Escape');
    await expect(searchInput).not.toBeVisible();
  });
});
