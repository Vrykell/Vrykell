import { test, expect } from '@playwright/test';
import { setupTauriMock, emitPtyOutput, expectAnyTermContains, clipboardText, ptyWrites } from './tauri-mock';

interface RunningTermScrollProbe {
  buffer: { active: { viewportY: number; baseY: number } };
  scrollToBottom(): void;
}

/**
 * 运行中 block 的活终端：block 卡片直接挂载真实可见的 xterm 实例
 *（RunningTerm / getExecutingTerm），输出走 xterm 原生渲染管线 ——
 * 光标、IME、选区、CJK 栅格对齐全部天然正确，不再有 250ms HTML 快照。
 * 块完成后活终端 dispose，done 块回退到静态 HTML 快照。
 */

async function startRunningBlock(page: import('@playwright/test').Page) {
  const input = page.getByPlaceholder(/输入命令/);
  await expect(input).toBeVisible({ timeout: 5000 });
  // Wait for the shell prompt before injecting a sustained command.
  await page.waitForFunction(async () => {
    const path = '/src/features/terminal/stores/terminal.ts';
    const { useTerminalStore } = await import(path) as typeof import('../src/features/terminal/stores/terminal');
    return Object.values(useTerminalStore.getState().startupStates).includes('ready');
  });
  await emitPtyOutput(page, `\x1b]133;E;${btoa('sleep 100')}\x07\x1b]133;C\x07`);
  await expect(page.locator('[data-tip="终止命令"]')).toBeVisible({ timeout: 5000 });
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

test('running block redraw preserves its output and process without sending PTY input', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await startRunningBlock(page);
  await emitPtyOutput(page, 'live-before-redraw\r\n');
  await expectAnyTermContains(page, 'live-before-redraw');
  const block = page.locator('[data-testid^="running-block-"]').first();
  const blockId = await block.getAttribute('data-command-block-id');
  const before = await ptyWrites(page);
  await block.hover();
  await page.clock.pauseAt(new Date());
  const redraw = block.getByRole('button', { name: '重绘终端' });
  await redraw.click();
  await expect(redraw).toBeDisabled();
  await expect(redraw).toHaveAttribute('aria-busy', 'true');
  await expect(redraw.locator('svg')).toHaveCSS('animation-name', 'spin');
  await page.clock.runFor(850);
  await expect(redraw).toBeEnabled();
  await expect(redraw.locator('svg')).toHaveCSS('animation-name', 'none');
  await page.clock.resume();
  await expect(block).toHaveAttribute('data-command-block-id', blockId!);
  await expect(block).toHaveAttribute('data-running', 'true');
  await expect(block.getByTestId('running-term').locator('.xterm')).toBeVisible();
  await expectAnyTermContains(page, 'live-before-redraw');
  expect(await ptyWrites(page)).toEqual(before);
  await emitPtyOutput(page, 'live-after-redraw\r\n');
  await expectAnyTermContains(page, 'live-after-redraw');
});

test('已有历史命令时，运行中的输出会持续保持在可见区域', async ({ page }) => {
  await setupTauriMock(page);
  await page.setViewportSize({ width: 800, height: 320 });
  await page.goto('/');
  const input = page.getByPlaceholder(/输入命令/);
  await expect(input).toBeVisible({ timeout: 5000 });
  await input.fill('echo previous');
  await input.press('Enter');
  await expect(page.getByTestId('exit-code')).toHaveCount(1);

  await startRunningBlock(page);
  const host = page.getByTestId('running-term');
  await expect(host.locator('.xterm')).toBeVisible({ timeout: 5000 });
  await emitPtyOutput(page, Array.from({ length: 40 }, (_, i) => `live-${i}`).join('\r\n') + '\r\n');
  await expectAnyTermContains(page, 'live-39', 3000);

  const scroller = page.locator('[data-testid^="terminal-scroll-"]').first();
  await expect.poll(() => scroller.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(32);
  await expect(host.locator('.xterm')).toBeVisible();
  await expect(page.getByTestId('exit-code')).toHaveCount(1);
});

test('重新加载会话模块后仍能取得运行中的活终端', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await startRunningBlock(page);
  const available = await page.evaluate(async () => {
    const scroller = document.querySelector<HTMLElement>('[data-testid^="terminal-scroll-"]');
    const paneId = scroller?.dataset.testid?.slice('terminal-scroll-'.length);
    const moduleUrl = `/src/features/terminal/hooks/useTerminalSession.ts?registry-check=${Date.now()}`;
    const fresh = await import(/* @vite-ignore */ moduleUrl);
    return Boolean(paneId && fresh.getExecutingTerm(paneId));
  });
  expect(available).toBe(true);
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
  await page.locator('[data-testid^="running-block-"]').first().hover();
  await page.locator('[data-tip="进入全屏交互"]').click();
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
  await page.locator('[data-tip="退出全屏"]').click();
  await expect(cardHost.locator('.xterm')).toBeVisible();
  await expect(page.getByTestId('tui-fullscreen')).toHaveCount(0);
});

test('全屏终端右键菜单提供快捷操作与复制/粘贴', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await startRunningBlock(page);
  await page.locator('[data-testid^="running-block-"]').first().hover();
  await page.locator('[data-tip="进入全屏交互"]').click();
  const fs = page.getByTestId('tui-fullscreen');
  await expect(fs.locator('.xterm')).toBeVisible();

  await emitPtyOutput(page, '\x1b[2;1Hfullscreen-copy-target');
  await expectAnyTermContains(page, 'fullscreen-copy-target');

  await fs.locator('.xterm').click({ button: 'right' });
  const menu = page.getByRole('menu', { name: '操作菜单' });
  await expect(menu).toBeVisible();
  for (const [index, label] of ['重绘终端', '终止命令', '结束前台应用', '退出全屏', '复制', '粘贴'].entries()) {
    await expect(menu.getByRole('button').nth(index)).toContainText(label);
  }
  await expect(menu.getByLabel('Control+C').first()).toBeVisible();
  await expect(menu.getByLabel('Control+V').first()).toBeVisible();

  // Copy reads the terminal the fullscreen host displays; the hidden main terminal has no selection.
  const target = 'fullscreen-copy-target';
  await page.evaluate((text) => {
    const terms = (window as unknown as {
      __vrykellTerms?: Map<string, { select: (column: number, row: number, length: number) => void }>;
    }).__vrykellTerms!;
    const key = [...terms.keys()].find((entry) => entry.startsWith('block:'))!;
    terms.get(key)!.select(0, 1, text.length);
  }, target);
  await menu.getByRole('button', { name: '复制' }).click();
  await expect.poll(() => clipboardText(page)).toBe(target);

  // The menu keeps the toolbar actions working from the fullscreen surface.
  const before = (await ptyWrites(page)).length;
  await fs.locator('.xterm').click({ button: 'right' });
  await menu.getByRole('button', { name: '终止命令' }).click();
  await expect.poll(async () => (await ptyWrites(page)).slice(before)).toContain('\x03');

  await fs.locator('.xterm').click({ button: 'right' });
  await menu.getByRole('button', { name: '退出全屏' }).click();
  await expect(page.getByTestId('tui-fullscreen')).toHaveCount(0);
  await expect(page.locator('[data-testid^="running-block-"]').first()).toBeVisible();
});

test('手动全屏中进入真 alt 屏：让出可见面，显示主 xterm 的 TUI', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await startRunningBlock(page);
  await emitPtyOutput(page, 'tui-before-alt\r\n');
  await page.locator('[data-testid^="running-block-"]').first().hover();
  await page.locator('[data-tip="进入全屏交互"]').click();
  await expect(page.getByTestId('tui-fullscreen')).toBeVisible();

  // 前台程序切到备用缓冲区：内容只写主 xterm，块终端收不到任何字节。
  // 手动全屏必须让出表面，否则遮罩用冻结的块内容盖住真正的 TUI（用户看到黑屏）。
  await emitPtyOutput(page, '\x1b[?1049h' + 'ALT SCREEN CONTENT');

  await expect(page.getByTestId('tui-fullscreen')).toHaveCount(0);
  await expect(page.getByTestId('tui-banner')).toBeVisible();
  await expectAnyTermContains(page, 'ALT SCREEN CONTENT', 5000);
});

test('运行中块接管滚轮：xterm 回溯时不滚动外层命令历史', async ({ page }) => {
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

  const blockScroll = () => page.evaluate(() => {
    const terms = (window as unknown as { __vrykellTerms?: Map<string, RunningTermScrollProbe> }).__vrykellTerms;
    const key = [...(terms?.keys() ?? [])].find((entry) => entry.startsWith('block:'));
    const term = key ? terms?.get(key) : undefined;
    return { viewportY: term?.buffer.active.viewportY ?? -1, baseY: term?.buffer.active.baseY ?? -1 };
  });
  await page.evaluate(() => {
    const terms = (window as unknown as { __vrykellTerms?: Map<string, RunningTermScrollProbe> }).__vrykellTerms;
    const key = [...(terms?.keys() ?? [])].find((entry) => entry.startsWith('block:'));
    if (key) terms?.get(key)?.scrollToBottom();
  });
  const before = await blockScroll();
  expect(before.baseY).toBeGreaterThan(0);

  const parent = page.locator('[data-testid^="terminal-scroll-"]').first();
  const screen = host.locator('.xterm-screen');
  const screenBox = await screen.boundingBox();
  expect(screenBox).not.toBeNull();
  const screenPoint = { x: screenBox!.width / 2, y: screenBox!.height / 2 };
  await screen.hover({ position: screenPoint });
  const parentTop = await parent.evaluate((el) => el.scrollTop);
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await blockScroll()).viewportY).toBeLessThan(before.viewportY);
  await expect.poll(() => parent.evaluate((el) => el.scrollTop)).toBe(parentTop);
});

test('运行块挂载前到达的输出不破坏首次滚轮回溯', async ({ page }) => {
  await setupTauriMock(page);
  await page.setViewportSize({ width: 1000, height: 520 });
  await page.goto('/');
  const input = page.getByPlaceholder(/输入命令/);
  await expect(input).toBeVisible({ timeout: 5000 });
  await page.waitForFunction(async () => {
    const path = '/src/features/terminal/stores/terminal.ts';
    const { useTerminalStore } = await import(path) as typeof import('../src/features/terminal/stores/terminal');
    return Object.values(useTerminalStore.getState().startupStates).includes('ready');
  });

  // Output that overflows the screen arrives right after the command starts, while the
  // running block has not mounted yet and the live terminal is still written headless.
  await emitPtyOutput(page, `\x1b]133;E;${btoa('sleep 100')}\x07\x1b]133;C\x07`);
  await emitPtyOutput(
    page,
    Array.from({ length: 120 }, (_, i) => `pre-${i} ${'x'.repeat(60)}`).join('\r\n') + '\r\n',
  );

  const host = page.getByTestId('running-term');
  await expect(host.locator('.xterm')).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(600);

  const blockScroll = () => page.evaluate(() => {
    const terms = (window as unknown as { __vrykellTerms?: Map<string, RunningTermScrollProbe> }).__vrykellTerms;
    const key = [...(terms?.keys() ?? [])].find((entry) => entry.startsWith('block:'));
    const term = key ? terms?.get(key) : undefined;
    return { viewportY: term?.buffer.active.viewportY ?? -1, baseY: term?.buffer.active.baseY ?? -1 };
  });
  const before = await blockScroll();
  expect(before.baseY).toBeGreaterThan(30);

  const screen = host.locator('.xterm-screen');
  const screenBox = await screen.boundingBox();
  expect(screenBox).not.toBeNull();
  await screen.hover({ position: { x: screenBox!.width / 2, y: screenBox!.height / 2 } });
  await page.mouse.wheel(0, -80);
  await page.waitForTimeout(300);

  // The first wheel-up must walk up from the bottom instead of collapsing to the start of
  // the scrollback: a stale scrollbar model turns the wheel delta into a jump to line 0.
  const after = await blockScroll();
  expect(after.viewportY).toBeLessThan(before.viewportY);
  expect(after.viewportY).toBeGreaterThan(0);
  expect(before.viewportY - after.viewportY).toBeLessThanOrEqual(20);
});

test('块终端与页面同色且无圆角，裁剪仍落在 el', async ({ page }) => {
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
      canvasBg: getComputedStyle(document.querySelector('[data-testid^="terminal-scroll-"]')!).backgroundColor,
      viewportBg,
      cropOnInner: /px$/.test(inner.style.height) && !/px$/.test(el.style.height),
    };
  });
  expect(probe.innerBg).toBe(probe.canvasBg);
  expect(parseFloat(probe.innerRadius)).toBe(0);
  expect(probe.viewportBg).toBe('rgba(0, 0, 0, 0)');
  expect(probe.cropOnInner).toBe(true);
});
