import { test, expect } from '@playwright/test';
import { setupTauriMock, ensureTabsOpen } from './tauri-mock';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  // 打开标签管理面板
  await ensureTabsOpen(page);
  await expect(page.locator('[data-testid="tab-search"]')).toBeVisible();
});

test.describe('标签页管理侧栏', () => {
  test('顶栏依次为搜索框、历史按钮、新建按钮', async ({ page }) => {
    await expect(page.locator('[data-testid="tab-search"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-history-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-new-btn"]')).toBeVisible();
  });

  test('搜索框按名字过滤活跃会话', async ({ page }) => {
    // 用快捷键新建第二个标签（默认标题「新会话」）
    await page.keyboard.press('Meta+t');
    await expect(page.locator('[data-testid^="tab-row-"]')).toHaveCount(2);
    // 过滤无结果
    await page.locator('[data-testid="tab-search"]').fill('不存在的名字');
    await expect(page.locator('[data-testid^="tab-row-"]')).toHaveCount(0);
    await expect(page.getByText('无匹配会话')).toBeVisible();
    // 清空恢复
    await page.locator('[data-testid="tab-search"]').fill('');
    await expect(page.locator('[data-testid^="tab-row-"]')).toHaveCount(2);
  });

  test('点击新建直接弹出类型选择弹窗、支持搜索过滤并创建', async ({ page }) => {
    await page.locator('[data-testid="tab-new-btn"]').click();
    // 无中间菜单，直接弹出类型选择弹窗
    await expect(page.getByText('新建标签页')).toBeVisible();
    await expect(page.getByText('Zsh', { exact: true })).toBeVisible();
    await expect(page.getByText('Bash', { exact: true })).toBeVisible();

    // 搜索过滤
    await page.locator('input[placeholder="搜索标签页类型…"]').fill('bash');
    await expect(page.getByText('Bash', { exact: true })).toBeVisible();
    await expect(page.getByText('Zsh', { exact: true })).toHaveCount(0);

    // 创建 bash 标签
    await page.getByText('Bash', { exact: true }).click();
    await expect(page.locator('[data-testid^="tab-row-"]')).toHaveCount(2);
    // 弹窗关闭
    await expect(page.getByText('新建标签页')).toHaveCount(0);
  });

  test('历史按钮新建会话历史查看标签页', async ({ page }) => {
    await page.locator('[data-testid="tab-history-btn"]').click();
    // 主区域渲染会话历史视图（仅历史会话，mock 返回 1 个历史 + 1 个活跃）
    await expect(page.getByText('旧的调试会话')).toBeVisible();
    await expect(page.getByText('1 个会话')).toBeVisible();
  });

  test('标签右键菜单靠近窗口边缘时仍完整显示', async ({ page }) => {
    await page.evaluate(() => {
      const row = document.querySelector<HTMLElement>('[data-tab-row-id]');
      if (!row) throw new Error('未找到标签行');
      row.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: window.innerWidth - 2,
        clientY: window.innerHeight - 2,
      }));
    });

    const menu = page.getByRole('menu', { name: '操作菜单' });
    await expect(menu).toBeVisible();
    const bounds = await menu.boundingBox();
    const viewport = page.viewportSize();
    expect(bounds).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport!.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport!.height);
  });

  test('非活跃标签悬停时才显示关闭按钮', async ({ page }) => {
    await page.keyboard.press('Meta+t');
    const rows = page.locator('[data-testid^="tab-row-"]');
    await expect(rows).toHaveCount(2);
    // 第一个标签（初始）已非活跃，其关闭按钮透明
    const firstRow = rows.first();
    const close = firstRow.locator('[data-testid^="tab-close-"]');
    await expect(close).toHaveCSS('opacity', '0');
    // 悬停行后出现
    await firstRow.hover();
    await expect(close).toHaveCSS('opacity', '1');
  });
});
