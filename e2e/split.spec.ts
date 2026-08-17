import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
});

test.describe('停靠网格', () => {
  test('两个标签自动停靠为两个 pane，各自有输入栏', async ({ page }) => {
    await page.keyboard.press('Meta+t'); // 新建第二个标签（自动停靠到下一个空槽）
    await expect(page.locator('[data-testid^="pane-"]')).toHaveCount(2);
    await expect(page.locator('.xterm')).toHaveCount(2);
    await expect(page.getByPlaceholder(/输入命令/)).toHaveCount(2);

    // 每个 pane 宿主非零尺寸（否则空白）
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

  test('⌘] / ⌘[ 在停靠终端间切换焦点', async ({ page }) => {
    await page.keyboard.press('Meta+t');
    const panes = page.locator('[data-testid^="pane-"]');
    // 新建标签是活跃标签，停靠在槽位 1（右侧）→ nth(1) 聚焦
    await expect(panes.nth(1)).toHaveAttribute('data-focused', 'true');
    await expect(panes.nth(0)).toHaveAttribute('data-focused', 'false');

    await page.keyboard.press('Meta+]');
    await expect(panes.nth(0)).toHaveAttribute('data-focused', 'true');
    await expect(panes.nth(1)).toHaveAttribute('data-focused', 'false');

    await page.keyboard.press('Meta+[');
    await expect(panes.nth(1)).toHaveAttribute('data-focused', 'true');
    await expect(panes.nth(0)).toHaveAttribute('data-focused', 'false');
  });

  test('拖拽标签到终端区域显示预停靠高亮并完成停靠', async ({ page }) => {
    await page.locator('[data-dock-btn="tabs"]').click();
    await expect(page.locator('[data-testid^="tab-row-"]')).toHaveCount(1);
    await page.keyboard.press('Meta+t');
    await expect(page.locator('[data-testid^="tab-row-"]')).toHaveCount(2);
    // 两个标签已自动停靠 → 2 个 pane
    await expect(page.locator('[data-testid^="pane-"]')).toHaveCount(2);

    const tabRow = page.locator('[data-testid^="tab-row-"]').first();
    const box = await tabRow.boundingBox();
    const zone = await page.locator('[data-terminal-dock-zone]').boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    // 拖到终端区域右下象限
    await page.mouse.move(zone!.x + zone!.width * 0.8, zone!.y + zone!.height * 0.8, { steps: 12 });
    // 预停靠高亮出现
    await expect(page.getByTestId('drop-zone-3')).toBeVisible();
    await page.mouse.up();
    // 停靠完成：仍是 2 个 pane（位置已调整）
    await expect(page.locator('[data-testid^="pane-"]')).toHaveCount(2);
  });
});
