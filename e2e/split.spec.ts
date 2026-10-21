import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { focusedPane, hoverPlacementZone, pickPlacementZone } from './placement';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
});

/**
 * 落点覆盖层按指针所在半屏判定：悬停时只渲染该落点的灰色预览（带方位与动作提示），
 * 点击确认。悬停坐标从窗格几何推出（placement.ts），不再渲染全部落点的网格。
 */
test.describe('窗口分裂（二叉分裂树 + 落点选择）', () => {
  test('horizontal panes retain usable width after divider dragging and sidebar resize', async ({ page }) => {
    await page.keyboard.press('Meta+d');
    await pickPlacementZone(page, focusedPane(page), 'right');
    const divider = page.getByTestId('terminal-divider-row');
    const rect = (await divider.boundingBox())!;
    const main = (await page.locator('main').boundingBox())!;
    await page.mouse.move(rect.x + rect.width / 2, rect.y + 100);
    await page.mouse.down(); await page.mouse.move(main.x + 5, rect.y + 100, { steps: 8 }); await page.mouse.up();
    const checkWidths = async () => {
      await expect.poll(() => page.locator('[data-testid^="pane-"]:visible').evaluateAll(elements =>
        Math.min(...elements.map(element => element.getBoundingClientRect().width)))).toBeGreaterThanOrEqual(359);
      const widths = await page.locator('[data-testid^="pane-"]:visible').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().width));
      expect(widths).toHaveLength(2);
      for (const width of widths) expect(width).toBeGreaterThanOrEqual(359);
    };
    await checkWidths();
    await page.locator('[data-dock-btn="chat"]').click();
    await checkWidths();
    for (const button of await page.getByRole('button', { name: '询问 AI', exact: true }).all()) await expect(button).toBeInViewport();
    await page.setViewportSize({ width: 900, height: 800 });
    await checkWidths();
  });
  test('⌘D 进入落点选择，点右半屏分裂出两个终端', async ({ page }) => {
    await page.keyboard.press('Meta+d');
    // 1 个终端 → 4 个半屏落点；悬停右半屏时只显示这一个灰色预览
    const point = await hoverPlacementZone(page, focusedPane(page), 'right');
    const preview = page.getByTestId('placement-zone-1');
    await expect(preview).toBeVisible();
    await expect(preview).toHaveText('点击此处分裂终端');
    await page.mouse.click(point.x, point.y);
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
    await pickPlacementZone(page, focusedPane(page), 'right');
    await expect(page.locator('[data-testid^="pane-"]:visible')).toHaveCount(2);
    await page.keyboard.press('Meta+t');
    // 旧 tab 保活（display:none 而非卸载），只数可见 pane
    await expect(page.locator('[data-testid^="pane-"]:visible')).toHaveCount(1);
  });

  test('⌘] / ⌘[ 在当前窗口的终端间切换焦点', async ({ page }) => {
    await page.keyboard.press('Meta+d');
    await pickPlacementZone(page, focusedPane(page), 'right');
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
    await page.getByTestId('new-tab-option-ssh:ssh-1').click();
    // 进入落点选择
    await expect(page.getByTestId('placement-overlay')).toBeVisible();
    await pickPlacementZone(page, focusedPane(page), 'right');
    await expect(page.locator('[data-testid^="pane-"]')).toHaveCount(2);
  });

  test('分裂到 4 个终端后不再分裂', async ({ page }) => {
    const panes = page.locator('[data-testid^="pane-"]:visible');
    // 1 → 2：右半屏；2 → 3：左窗格上半屏；3 → 4：右窗格上半屏
    await page.keyboard.press('Meta+d');
    await pickPlacementZone(page, focusedPane(page), 'right');
    await expect(panes).toHaveCount(2);
    await page.keyboard.press('Meta+d');
    await pickPlacementZone(page, panes.nth(0), 'top');
    await expect(panes).toHaveCount(3);
    await page.keyboard.press('Meta+d');
    await pickPlacementZone(page, panes.nth(2), 'top');
    await expect(panes).toHaveCount(4);
    // 再分裂：深一层的叶子没有落点，提示后保持 4 个
    await page.keyboard.press('Meta+d');
    await expect(page.getByText('最多 4 个终端')).toBeVisible();
    await expect(page.locator('[data-testid^="placement-zone-"]')).toHaveCount(0);
    await expect(panes).toHaveCount(4);
  });
});
