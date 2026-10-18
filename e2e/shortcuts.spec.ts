import { test, expect } from '@playwright/test';
import { setupTauriMock, ensureTabsOpen } from './tauri-mock';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
});

test.describe('全局快捷键', () => {
  test('Cmd+T 新建标签，Cmd+W 关闭标签', async ({ page }) => {
    // 打开标签面板
    await ensureTabsOpen(page);
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
    await ensureTabsOpen(page);
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
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Meta+,');
    await expect(page.getByTestId('provider-endpoint-input').first()).toBeVisible();
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

  test('页面缩放快捷键和滚轮不会改变字号或页面比例', async ({ page }) => {
    const initialFontSize = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
    await page.keyboard.press('Meta+=');
    await page.keyboard.press('Meta+-');
    await page.keyboard.press('Meta+0');
    await page.keyboard.press('Control+=');
    const result = await page.evaluate(() => {
      const wheel = new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, cancelable: true, bubbles: true });
      window.dispatchEvent(wheel);
      return {
        fontSize: getComputedStyle(document.documentElement).fontSize,
        inlineFontSize: document.documentElement.style.fontSize,
        wheelPrevented: wheel.defaultPrevented,
      };
    });
    expect(result.fontSize).toBe(initialFontSize);
    expect(result.inlineFontSize).toBe('');
    expect(result.wheelPrevented).toBe(true);
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
