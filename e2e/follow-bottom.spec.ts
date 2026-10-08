import { test, expect } from '@playwright/test';
import { setupTauriMock, emitPtyOutput } from './tauri-mock';

/** 找到 block 列表滚动容器 */
async function scrollEl(page: import('@playwright/test').Page) {
  const handle = await page.evaluateHandle(() => {
    const card = document.querySelector('[data-testid="exit-code"]');
    let el = card?.parentElement ?? null;
    while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY)) el = el.parentElement;
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

  await expect(page.locator('[data-testid^="terminal-scroll-"]').first()).toBeVisible();
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

test('live output continues following after content grows and the viewport changes', async ({ page }) => {
  await setupTauriMock(page);
  await page.setViewportSize({ width: 1000, height: 500 });
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await expect(page.locator('[data-testid^="terminal-scroll-"]').first()).toBeVisible();
  for (let i = 0; i < 5; i++) {
    const command = `history-${i}`;
    await emitPtyOutput(page, `\x1b]133;E;${btoa(command)}\x07\x1b]133;C\x07${'history output\r\n'.repeat(20)}\x1b]133;D;0\x07\x1b]133;A\x07`);
    await expect(page.getByTestId('exit-code')).toHaveCount(i + 1);
  }
  await emitPtyOutput(page, '\x1b]133;E;c3RyZWFt\x07\x1b]133;C\x07');
  const scroller = page.locator('[data-testid^="terminal-scroll-"]').first();
  const gap = () => scroller.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight);
  for (let i = 0; i < 6; i++) {
    await emitPtyOutput(page, Array.from({ length: 18 }, (_, line) => `chunk-${i}-${line}\r\n`).join(''));
    await expect.poll(() => page.evaluate((marker) => {
      const terms = (window as unknown as { __vrykellTerms: Map<string, import('@xterm/xterm').Terminal> }).__vrykellTerms;
      const term = [...terms.entries()].find(([key]) => key.startsWith('block:'))?.[1];
      if (!term) return false;
      return Array.from({ length: term.buffer.active.length }, (_, row) => term.buffer.active.getLine(row)?.translateToString()).some(line => line?.includes(marker));
    }, `chunk-${i}-17`)).toBe(true);
    await expect.poll(gap).toBeLessThan(32);
    if (i === 2) await page.setViewportSize({ width: 720, height: 400 });
  }
  await scroller.hover();
  await page.mouse.wheel(0, -350);
  await expect.poll(gap).toBeGreaterThan(100);
  const top = await scroller.evaluate(el => el.scrollTop);
  await emitPtyOutput(page, 'output-while-reading\r\n'.repeat(20));
  await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBe(top);
  await emitPtyOutput(page, '\x1b]133;D;0\x07\x1b]133;A\x07');
});


test('short commands preserve real wrapped history geometry without a reverse scroll frame', async ({ page }) => {
  await setupTauriMock(page);
  await page.setViewportSize({ width: 720, height: 500 });
  await page.goto('/');
  const input = page.getByPlaceholder(/输入命令/);
  await expect(input).toBeVisible();
  for (let i = 0; i < 12; i++) {
    const command = `wrapped-${i}`;
    await emitPtyOutput(page, `\x1b]133;E;${btoa(command)}\x07\x1b]133;C\x07${'wrapped-long-output '.repeat(25)}\r\n\x1b]133;D;0\x07\x1b]133;A\x07`);
    await expect(page.getByTestId('exit-code')).toHaveCount(i + 1);
  }
  await page.evaluate(() => {
    const scroll = document.querySelector<HTMLElement>('[data-testid^="terminal-scroll-"]')!;
    const marker = scroll.querySelector<HTMLElement>('[data-testid^="command-block-"]:last-child')
      ?? [...scroll.querySelectorAll<HTMLElement>('[data-testid^="command-block-"]')].at(-1)!;
    scroll.scrollTop = scroll.scrollHeight;
    const scope = window as unknown as { historyFrames: Array<{ top: number; gap: number; height: number }>; historyFrame: number };
    scope.historyFrames = [];
    const sample = () => {
      scope.historyFrames.push({ top: marker.getBoundingClientRect().top, gap: scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight, height: marker.offsetHeight });
      scope.historyFrame = requestAnimationFrame(sample);
    };
    scope.historyFrame = requestAnimationFrame(sample);
  });
  for (let i = 0; i < 4; i++) {
    await input.fill('ls'); await input.press('Enter');
    await expect(page.getByTestId('exit-code')).toHaveCount(13 + i);
  }
  const frames = await page.evaluate(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const scope = window as unknown as { historyFrames: Array<{ top: number; gap: number; height: number }>; historyFrame: number };
    cancelAnimationFrame(scope.historyFrame);
    return scope.historyFrames;
  });
  expect(frames.length).toBeGreaterThan(3);
  expect(new Set(frames.map(frame => frame.height)).size).toBe(1);
  expect(Math.max(...frames.slice(1).map((frame, index) => frame.top - frames[index]!.top))).toBeLessThan(1.1);
  expect(Math.max(...frames.map(frame => frame.gap))).toBeLessThan(2);
});
