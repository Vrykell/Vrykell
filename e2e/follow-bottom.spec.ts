import { test, expect } from '@playwright/test';
import { setupTauriMock, emitPtyOutput } from './tauri-mock';

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

test('改变终端宽度时保持阅读位置，贴底状态保持贴底', async ({ page }) => {
  await setupTauriMock(page);
  await page.setViewportSize({ width: 1100, height: 500 });
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });

  for (let i = 0; i < 14; i++) {
    const command = `line-${i}`;
    const output = `${command} ${'x'.repeat(170)}\r\n`;
    await emitPtyOutput(page, `\x1b]133;E;${btoa(command)}\x07\x1b]133;C\x07${output}\x1b]133;D;0\x07\x1b]133;A\x07`);
    await expect(page.getByTestId('exit-code')).toHaveCount(i + 1);
  }

  const scroller = page.locator('[data-testid^="terminal-scroll-"]').first();
  const target = page.locator('[data-testid^="command-block-"]').nth(7);
  await target.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  const relativeTop = async () => target.evaluate((el) => {
    const scroll = el.closest<HTMLElement>('[data-testid^="terminal-scroll-"]')!;
    return el.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
  });
  const before = await relativeTop();
  await page.setViewportSize({ width: 720, height: 500 });
  await expect.poll(async () => Math.abs((await relativeTop()) - before)).toBeLessThan(24);

  await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.setViewportSize({ width: 980, height: 500 });
  await expect.poll(() => scroller.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(32);
});
