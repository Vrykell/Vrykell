import { test, expect } from '@playwright/test';
import { setupTauriMock, emitPtyOutput, expectAnyTermContains } from './tauri-mock';

/**
 * 运行中 block 的活终端：block 卡片直接挂载真实可见的 xterm 实例
 *（RunningTerm / getExecutingTerm），输出走 xterm 原生渲染管线 ——
 * 光标、IME、选区、CJK 栅格对齐全部天然正确，不再有 250ms HTML 快照。
 * 块完成后活终端 dispose，done 块回退到静态 HTML 快照。
 */

async function startRunningBlock(page: import('@playwright/test').Page) {
  const input = page.getByPlaceholder(/输入命令/);
  await expect(input).toBeVisible({ timeout: 5000 });
  await emitPtyOutput(page, `\x1b]133;E;${btoa('sleep 100')}\x07\x1b]133;C\x07`);
  await expect(page.getByTitle('终止命令 (Ctrl+C)')).toBeVisible({ timeout: 5000 });
}

test('运行中 block 挂载可见 xterm，输出实时渲染，完成后换成快照', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await startRunningBlock(page);

  // 活 xterm 挂在 running-term 宿主里（open() 产出 .xterm DOM）
  const host = page.getByTestId('running-term');
  await expect(host.locator('.xterm')).toBeVisible({ timeout: 5000 });

  // PTY 输出实时出现在块终端的渲染里（WebGL 下读 buffer 断言，无 250ms 快照延迟）
  await emitPtyOutput(page, 'hello world\r\n');
  await expectAnyTermContains(page, 'hello world', 3000);

  // 块完成（D）：活 xterm 消失，done 块显示静态 HTML 快照
  await emitPtyOutput(page, `\x1b]133;D;0\x07`);
  await expect(host.locator('.xterm')).toBeHidden({ timeout: 3000 });
  await expect(page.getByText('hello world')).toBeVisible({ timeout: 3000 });
});

test('运行中焦点落在块内活 xterm 的 textarea（而非隐藏主 xterm）', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await startRunningBlock(page);

  // 焦点从 body 收归活终端（useTerminalFocus 优先 getExecutingTerm）
  await expect
    .poll(() =>
      page.evaluate(() => {
        const ae = document.activeElement;
        return (
          ae?.classList.contains('xterm-helper-textarea') === true &&
          !!ae.closest('[data-testid="running-term"]')
        );
      }),
    )
    .toBe(true);
});

test('手动全屏：块内活终端搬进全屏宿主，退出后搬回卡片', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await startRunningBlock(page);
  await emitPtyOutput(page, 'tui-content-line\r\n');
  const cardHost = page.getByTestId('running-term');
  await expectAnyTermContains(page, 'tui-content-line', 3000);

  // 进入全屏：el 搬进 tui-fullscreen，内容仍在（块路由下主 xterm 是空壳）
  await page.getByTitle('进入全屏交互').click();
  const fs = page.getByTestId('tui-fullscreen');
  await expect(fs.locator('.xterm')).toBeVisible();
  await expect(cardHost.locator('.xterm')).toHaveCount(0);

  // 全屏宿主铺满整个终端区：块终端画布应填满宿主内容宽/高，两侧无黑条
  //（回归：PTY/块终端曾按单 pane 宽换算列数，全屏时画布居中 → 左右露底色）
  await expect(async () => {
    const probe = await fs.evaluate((host) => {
      const screen = host.querySelector<HTMLElement>('.xterm-screen')!;
      const padTop = parseFloat(host.style.paddingTop) || 0;
      return {
        hostW: host.clientWidth,
        hostH: host.clientHeight - padTop,
        screenW: screen.getBoundingClientRect().width,
        screenH: screen.getBoundingClientRect().height,
      };
    });
    expect(probe.screenW).toBeGreaterThanOrEqual(probe.hostW - 10);
    expect(probe.screenH).toBeGreaterThanOrEqual(probe.hostH - 20);
  }).toPass({ timeout: 5000 });

  // 全屏中输出继续实时到达
  await emitPtyOutput(page, 'tui-second-line\r\n');
  await expectAnyTermContains(page, 'tui-second-line');

  // esc 退出全屏 → el 搬回卡片
  await page.getByTitle('退出全屏').click();
  await expect(cardHost.locator('.xterm')).toBeVisible();
  await expect(page.getByTestId('tui-fullscreen')).toHaveCount(0);
});

test('卡片内滚轮冒泡到块列表滚动容器（不被块 xterm 吞掉）', async ({ page }) => {
  await setupTauriMock(page);
  // 小视口保证块列表溢出可滚（卡片高度跟随内容行数增长）
  await page.setViewportSize({ width: 800, height: 320 });
  await page.goto('/');
  await startRunningBlock(page);
  const host = page.getByTestId('running-term');
  await expect(host.locator('.xterm')).toBeVisible({ timeout: 5000 });

  // 输出足够多行让块列表溢出
  await emitPtyOutput(
    page,
    Array.from({ length: 40 }, (_, i) => `line-${i}`).join('\r\n') + '\r\n',
  );
  await expectAnyTermContains(page, 'line-39', 3000);

  const setTop = (top: number) =>
    page.evaluate((t) => {
      let el: HTMLElement | null = document.querySelector('[data-testid="running-term"]');
      while (el && !/auto|scroll/.test(getComputedStyle(el).overflowY)) el = el.parentElement;
      if (el) el.scrollTop = t;
    }, top);
  const scrollerTop = () =>
    page.evaluate(() => {
      let el: HTMLElement | null = document.querySelector('[data-testid="running-term"]');
      while (el && !/auto|scroll/.test(getComputedStyle(el).overflowY)) el = el.parentElement;
      return el?.scrollTop ?? -1;
    });

  // 先滚到顶部，留出向下滚动空间（渲染完成后 follow-bottom 已把容器贴在底部）
  await setTop(0);
  await expect(async () => {
    expect(await scrollerTop()).toBeLessThan(50);
  }).toPass({ timeout: 3000 });

  // 滚轮落在运行中卡片的 xterm 上：事件应冒泡给块列表 DOM 滚动容器
  //（回归：xterm 默认吞 wheel 并 preventDefault，整页滚不动）
  const box = await host.locator('.xterm').boundingBox();
  expect(box).not.toBeNull();
  // 取卡片可视区域内的一点（避开顶部卡片头与底部输入栏）
  const wheelY = Math.min(box!.y + 60, 250);
  await page.mouse.move(box!.x + box!.width / 2, wheelY);
  await page.mouse.wheel(0, 300);

  await expect(async () => {
    expect(await scrollerTop()).toBeGreaterThan(50);
  }).toPass({ timeout: 5000 });
});

test('块终端是深色圆角盒子：el 底色 --xterm-bg + 圆角，裁剪落在 el', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await startRunningBlock(page);
  const host = page.getByTestId('running-term');
  await expect(host.locator('.xterm')).toBeVisible({ timeout: 5000 });
  await emitPtyOutput(page, 'hi\r\n');

  const probe = await host.evaluate((el) => {
    const inner = el.firstElementChild as HTMLElement;
    const cs = getComputedStyle(inner);
    const viewportBg = getComputedStyle(el.querySelector('.xterm-viewport')!).backgroundColor;
    return {
      innerBg: cs.backgroundColor,
      innerRadius: cs.borderTopLeftRadius,
      viewportBg,
      cropOnInner: /px$/.test(inner.style.height) && !/px$/.test(el.style.height),
    };
  });
  expect(probe.innerBg).toBe('rgb(17, 20, 23)'); // --xterm-bg #111417
  expect(parseFloat(probe.innerRadius)).toBeGreaterThanOrEqual(6);
  expect(probe.viewportBg).toBe('rgba(0, 0, 0, 0)'); // 滚动条侧条不露 #000
  expect(probe.cropOnInner).toBe(true);
});
