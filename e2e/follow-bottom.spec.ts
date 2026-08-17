import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

/** 找到 block 列表滚动容器 */
async function scrollEl(page: import('@playwright/test').Page) {
  const handle = await page.evaluateHandle(() => {
    const card = document.querySelector('[data-testid="exit-code"]');
    let el = card?.parentElement ?? null;
    while (el && getComputedStyle(el).overflowY !== 'auto') el = el.parentElement;
    return el;
  });
  return handle.asElement()!;
}

test('用户上滚后运行新命令，应重新贴底', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  const input = page.getByPlaceholder(/输入命令/);
  await expect(input).toBeVisible({ timeout: 5000 });

  // 跑 15 条命令制造溢出
  for (let i = 1; i <= 15; i++) {
    await input.fill(`echo line-${i}`);
    await input.press('Enter');
    await expect(page.getByTestId('exit-code')).toHaveCount(i, { timeout: 5000 });
  }

  // 用户上滚 300px 读历史输出
  const el = await scrollEl(page);
  await el.evaluate((e) => { e.scrollTop -= 300; });
  await page.waitForTimeout(100);
  const gapAfterScrollUp = await el.evaluate(
    (e) => e.scrollHeight - e.scrollTop - e.clientHeight,
  );
  expect(gapAfterScrollUp).toBeGreaterThan(32);

  // 用户运行新命令 —— ：应跳回底部
  await input.fill('echo after-scroll');
  await input.press('Enter');
  await expect(page.getByTestId('exit-code')).toHaveCount(16, { timeout: 5000 });
  await page.waitForTimeout(300);

  const gapAfterNewCmd = await el.evaluate(
    (e) => e.scrollHeight - e.scrollTop - e.clientHeight,
  );
  console.log(`gap after scroll up: ${gapAfterScrollUp}, after new cmd: ${gapAfterNewCmd}`);
  expect(gapAfterNewCmd).toBeLessThan(32);
});
