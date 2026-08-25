/**
 * 滚动条 e2e：默认完全隐藏；鼠标移动到滚动条区域（滚动容器右缘）才显示。
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
});

const scrollbarWidth = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const el = document.querySelector('[data-test-scroller]');
    return el ? getComputedStyle(el, '::-webkit-scrollbar').width : 'no-el';
  });

test('滚动条：默认隐藏，悬停滚动条区域显示，移开恢复隐藏', async ({ page }) => {
  // 执行多条命令，让终端块列表产生滚动内容
  const input = page.getByPlaceholder(/输入命令/);
  for (let i = 0; i < 12; i++) {
    await input.fill(`echo line${i}`);
    await input.press('Enter');
    await expect(page.getByText(`line${i}`).first()).toBeVisible({ timeout: 3000 });
  }

  // 定位块列表的滚动容器（overflowY auto/scroll 且包含命令块文本）
  const found = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('div'));
    const el = all.find(
      (d) =>
        (getComputedStyle(d).overflowY === 'auto' || getComputedStyle(d).overflowY === 'scroll') &&
        d.scrollHeight > d.clientHeight + 4 &&
        d.textContent?.includes('echo line'),
    );
    if (!el) return false;
    el.setAttribute('data-test-scroller', '');
    return true;
  });
  expect(found).toBe(true);

  // 默认隐藏：scrollbar 宽度 0
  expect(await scrollbarWidth(page)).toBe('0px');

  // 鼠标移到滚动条区域（容器右缘）
  const box = await page.locator('[data-test-scroller]').boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width - 4, box!.y + box!.height / 2);
  await expect.poll(() => scrollbarWidth(page)).toBe('8px');

  // 移开 → 恢复隐藏
  await page.mouse.move(box!.x + 20, box!.y + 20);
  await expect.poll(() => scrollbarWidth(page)).toBe('0px');
});
