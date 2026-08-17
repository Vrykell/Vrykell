import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
});

test.describe('窗口分裂（二叉分裂树 + 落点选择）', () => {
  test('⌘D 进入落点选择，点右半屏分裂出两个终端', async ({ page }) => {
    await page.keyboard.press('Meta+d');
    // 1 个终端 → 4 个落点（左右上下半屏）
    await expect(page.getByTestId('placement-zone-1')).toBeVisible();
    await page.getByTestId('placement-zone-1').click();
    await expect(page.locator('[data-testid^="pane-"]')).toHaveCount(2);
    await expect(page.getByPlaceholder(/输入命令/)).toHaveCount(2);

    const sizes = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid^="pane-"]')).map((el) => {
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height };
      }),
    );
    for (const s of sizes) {
      expect(s.w).toBeGreaterThan(100);
      expect(s.h).toBeGreaterThan(100);
    }
  });

  test('新建终端（新窗口）不自动加入当前窗口布局', async ({ page }) => {
    await page.keyboard.press('Meta+d');
    await page.getByTestId('placement-zone-1').click();
    await expect(page.locator('[data-testid^="pane-"]')).toHaveCount(2);
    await page.keyboard.press('Meta+t');
    await expect(page.locator('[data-testid^="pane-"]')).toHaveCount(1);
  });

  test('⌘] / ⌘[ 在当前窗口的终端间切换焦点', async ({ page }) => {
    await page.keyboard.press('Meta+d');
    await page.getByTestId('placement-zone-1').click();
    const panes = page.locator('[data-testid^="pane-"]');
    await expect(panes).toHaveCount(2);
    await expect(panes.nth(1)).toHaveAttribute('data-focused', 'true');
    await expect(panes.nth(0)).toHaveAttribute('data-focused', 'false');

    await page.keyboard.press('Meta+]');
    await expect(panes.nth(0)).toHaveAttribute('data-focused', 'true');
    await page.keyboard.press('Meta+[');
    await expect(panes.nth(1)).toHaveAttribute('data-focused', 'true');
  });

  test('⌥⌘D 选类型后进入落点选择，分裂出混搭终端', async ({ page }) => {
    await page.keyboard.press('Meta+Alt+d');
    await expect(page.getByText('新建标签页')).toBeVisible();
    await page.getByText('生产服务器').click();
    // 进入落点选择
    await expect(page.getByTestId('placement-zone-1')).toBeVisible();
    await page.getByTestId('placement-zone-1').click();
    await expect(page.locator('[data-testid^="pane-"]')).toHaveCount(2);
  });

  test('分裂到 4 个终端后不再分裂', async ({ page }) => {
    // 分裂 3 次到 4 个终端
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Meta+d');
      // 选一个可见落点（不同阶段落点数量不同，都点第一个）
      await page.locator('[data-testid^="placement-zone-"]').first().click();
    }
    await expect(page.locator('[data-testid^="pane-"]')).toHaveCount(4);
    // 再分裂：无落点，应保持 4 个
    await page.keyboard.press('Meta+d');
    await expect(page.locator('[data-testid^="placement-zone-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="pane-"]')).toHaveCount(4);
  });
});
