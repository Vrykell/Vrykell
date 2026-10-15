import { test, expect } from '@playwright/test';
import { setupTauriMock, ensureTabsOpen } from './tauri-mock';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
});

test.describe('应用布局', () => {
  test('TopDock 功能区：标签/资源按钮 + 设置入口', async ({ page }) => {
    // Navigation actions remain discoverable in the activity bar.
    await expect(page.locator('[data-dock-btn="tabs"]')).toBeVisible();
    await expect(page.locator('[data-dock-btn="files"]')).toBeVisible();
    await expect(page.locator('[data-dock-btn="settings"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-search"]')).toBeVisible();
    await expect(page.getByText('Documents')).toHaveCount(0);
    await expect(page.locator('[data-testid="ssh-search"]')).toHaveCount(0);
  });

  test('Windows/Linux 使用应用内窗口控制按钮', async ({ page }) => {
    test.skip(await page.evaluate(() => /Mac/.test(navigator.userAgent)), 'macOS 使用原生交通灯');
    const controls = page.locator('[data-testid="window-controls"]');
    await expect(controls).toBeVisible();
    await expect(controls.locator('button')).toHaveCount(3);
    const controlRight = await controls.evaluate((element) => element.getBoundingClientRect().right);
    const viewportRight = await page.evaluate(() => window.innerWidth);
    expect(Math.abs(viewportRight - controlRight)).toBeLessThanOrEqual(1);
    for (const width of [1240, 720]) {
      await page.setViewportSize({ width, height: 800 });
      const titlebar = await page.locator('.workspace-titlebar').boundingBox();
      for (const id of ['window-minimize', 'window-maximize', 'window-close']) {
        const button = page.getByTestId(id);
        const rect = await button.boundingBox();
        expect(rect!.y).toBe(0);
        expect(rect!.height).toBe(titlebar!.height);
        expect(await button.evaluate(el => {
          const bounds = el.getBoundingClientRect();
          return el.contains(document.elementFromPoint(bounds.x + bounds.width / 2, 0));
        })).toBe(true);
      }
    }
    await expect(page.getByText('Vrykell', { exact: true })).toHaveCount(0);

    const minimize = controls.locator('[data-testid="window-minimize"]');
    const close = controls.locator('[data-testid="window-close"]');
    await minimize.hover();
    await expect.poll(() => minimize.evaluate((element) => getComputedStyle(element).backgroundColor))
      .not.toBe('rgba(0, 0, 0, 0)');
    const neutralHover = await minimize.evaluate((element) => getComputedStyle(element).backgroundColor);
    await close.hover();
    await expect.poll(() => close.evaluate((element) => getComputedStyle(element).backgroundColor))
      .not.toBe('rgba(0, 0, 0, 0)');
    const dangerHover = await close.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(dangerHover).not.toBe(neutralHover);

    await controls.locator('[data-testid="window-minimize"]').click();
    await controls.locator('[data-testid="window-maximize"]').click();
    await controls.locator('[data-testid="window-close"]').click();
  });

  test('文件面板：点击资源按钮后显示目录和文件', async ({ page }) => {
    // 点击 "资源" dock 按钮打开文件面板
    await page.locator('[data-dock-btn="files"]').click();
    await expect(page.getByText('Documents')).toBeVisible({ timeout: 3000 });
    await expect(page.getByText('notes.txt')).toBeVisible();
  });

  test('终端区：xterm 挂载且有底部输入栏', async ({ page }) => {
    // 新管线默认进入 blockList，xterm 仍挂载但隐藏；底部输入栏应可见
    await expect(page.locator('.xterm')).toBeAttached();
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  });

  test('底部输入栏支持 AI 模式切换', async ({ page }) => {
    await page.getByRole('button', { name: '询问 AI', exact: true }).click();
    await expect(page.getByPlaceholder(/自然语言描述/)).toBeVisible();
    await page.locator('[data-dock-btn="chat"]').click();
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  });

  test('标签面板：打开面板 → 新建标签 → 切换', async ({ page }) => {
    // 新标签同样进入 blockList，xterm 挂载但隐藏
    await expect(page.locator('.xterm')).toBeAttached();
    // 点击 "标签" dock 按钮打开标签面板
    await ensureTabsOpen(page);
    // 面板内点击顶部新建按钮 → 直接弹出类型选择弹窗（无中间菜单）
    await page.locator('[data-testid="tab-new-btn"]').click();
    await page.getByText('Zsh', { exact: true }).click();
    // 验证两个标签都在面板中可见
    await expect(page.locator('[data-testid^="tab-row-"]')).toHaveCount(2);
    // 点击第一个标签切换回去
    await page.getByText('终端').first().click();
    await expect(page.locator('[data-testid^="tab-row-"]')).toHaveCount(2);
  });

  test('文档级滚动已锁定 — html/body overflow 裁剪', async ({ page }) => {
    const check = () => page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      scrollY: window.scrollY,
      bodyOverflow: getComputedStyle(document.body).overflow,
      htmlOverflow: getComputedStyle(document.documentElement).overflow,
    }));

    // html/body overflow 应为 hidden
    let s = await check();
    expect(s.htmlOverflow).toBe('hidden');
    expect(s.bodyOverflow).toBe('hidden');

    // 初始文档不可滚动
    expect(s.scrollHeight).toBeLessThanOrEqual(s.innerHeight + 2);
    expect(s.scrollY).toBe(0);

    // 打开面板后重新验证
    await ensureTabsOpen(page);
    await page.waitForTimeout(300);

    s = await check();
    expect(s.scrollY).toBe(0);
    expect(s.scrollHeight).toBeLessThanOrEqual(s.innerHeight + 2);
  });
});
