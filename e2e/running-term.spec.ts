import { test, expect } from '@playwright/test';
import { setupTauriMock, emitPtyOutput, expectAnyTermContains, clipboardText, ptyWrites } from './tauri-mock';

interface RunningTermScrollProbe {
  buffer: { active: { viewportY: number; baseY: number } };
  scrollToBottom(): void;
}

/**
 * Live terminal of a running block: the block card mounts a real, visible xterm instance
 * (RunningTerm / getExecutingTerm) and output flows through xterm's native rendering pipeline,
 * so cursor, IME, selection and CJK grid alignment are all correct as rendered, with no 250ms
 * HTML snapshot. When the block finishes the live terminal is disposed and the done block falls
 * back to a static HTML snapshot.
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

test('a running block mounts a visible xterm with live output and switches to a snapshot once finished', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await startRunningBlock(page);

  // The live xterm lives in the running-term host (open() produces the .xterm DOM).
  const host = page.getByTestId('running-term');
  await expect(host.locator('.xterm')).toBeVisible({ timeout: 5000 });

  // PTY output appears in the block terminal's rendering in real time (assert against the buffer under WebGL, with no 250ms snapshot delay).
  await emitPtyOutput(page, 'hello world\r\n');
  await expectAnyTermContains(page, 'hello world', 3000);

  // The block completes (D): the live xterm disappears and the done block shows a static HTML snapshot.
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

test('running output stays in view when earlier command history is present', async ({ page }) => {
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

test('the running live terminal is still reachable after reloading the session module', async ({ page }) => {
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

test('focus lands in the textarea of the block live xterm rather than the hidden main xterm', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await startRunningBlock(page);

  // Focus returns from the body to the live terminal (useTerminalFocus prefers getExecutingTerm).
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

test('manual fullscreen moves the block live terminal into the fullscreen host and back into the card on exit', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await startRunningBlock(page);
  await emitPtyOutput(page, 'tui-content-line\r\n');
  const cardHost = page.getByTestId('running-term');
  await expectAnyTermContains(page, 'tui-content-line', 3000);

  // Enter fullscreen: the element moves into tui-fullscreen and its content stays (under block routing the main xterm is an empty shell).
  await page.locator('[data-testid^="running-block-"]').first().hover();
  await page.locator('[data-tip="进入全屏交互"]').click();
  const fs = page.getByTestId('tui-fullscreen');
  await expect(fs.locator('.xterm')).toBeVisible();
  await expect(cardHost.locator('.xterm')).toHaveCount(0);

  // The fullscreen host fills the whole terminal area: the block terminal canvas should fill the
  // host content width and height with no dark bands on either side
  // (regression: the PTY and block terminal derived columns from a single pane width, so the
  // canvas sat centered in fullscreen and exposed the background on both sides).
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

  // Output keeps arriving in real time while fullscreen.
  await emitPtyOutput(page, 'tui-second-line\r\n');
  await expectAnyTermContains(page, 'tui-second-line');

  // Escape leaves fullscreen, moving the element back into the card.
  await page.locator('[data-tip="退出全屏"]').click();
  await expect(cardHost.locator('.xterm')).toBeVisible();
  await expect(page.getByTestId('tui-fullscreen')).toHaveCount(0);
});

test('the fullscreen terminal context menu offers shortcuts plus copy and paste', async ({ page }) => {
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
    await expect(menu.locator('button').nth(index)).toContainText(label);
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

test('entering the real alternate screen during manual fullscreen yields the surface to the main xterm TUI', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await startRunningBlock(page);
  await emitPtyOutput(page, 'tui-before-alt\r\n');
  await page.locator('[data-testid^="running-block-"]').first().hover();
  await page.locator('[data-tip="进入全屏交互"]').click();
  await expect(page.getByTestId('tui-fullscreen')).toBeVisible();

  // The foreground program switches to the alternate buffer: content goes only to the main
  // xterm and the block terminal receives no bytes at all. Manual fullscreen must yield the
  // surface, otherwise the overlay covers the real TUI with frozen block content (a black screen).
  await emitPtyOutput(page, '\x1b[?1049h' + 'ALT SCREEN CONTENT');

  await expect(page.getByTestId('tui-fullscreen')).toHaveCount(0);
  await expect(page.getByTestId('tui-banner')).toBeVisible();
  await expectAnyTermContains(page, 'ALT SCREEN CONTENT', 5000);
});

test('the pane context menu of a real alternate-screen TUI offers the banner shortcuts', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await startRunningBlock(page);
  await emitPtyOutput(page, '\x1b[?1049h' + 'ALT SCREEN CONTENT');
  await expect(page.getByTestId('tui-banner')).toBeVisible();
  await expectAnyTermContains(page, 'ALT SCREEN CONTENT', 5000);

  // Right-click the TUI surface: the banner actions lead the pane menu.
  await page.locator('.terminal-pane .xterm').first().click({ button: 'right' });
  const menu = page.getByRole('menu', { name: '操作菜单' });
  await expect(menu).toBeVisible();
  const labels = ['重绘终端', '终止命令', '结束前台应用', '复制', '粘贴', '拆分标签页'];
  for (const [index, label] of labels.entries()) {
    await expect(menu.locator('button').nth(index)).toContainText(label);
  }
  // The alternate screen already owns the surface, so no fullscreen toggle is offered.
  await expect(menu.getByRole('button', { name: '进入全屏交互' })).toHaveCount(0);

  const before = (await ptyWrites(page)).length;
  await menu.getByRole('button', { name: '终止命令' }).click();
  await expect.poll(async () => (await ptyWrites(page)).slice(before)).toContain('\x03');
});

test('a running block owns the wheel: xterm scrollback moves without scrolling the outer command history', async ({ page }) => {
  await setupTauriMock(page);
  // A small viewport keeps the block list overflowing so it can scroll (card height grows with content rows).
  await page.setViewportSize({ width: 800, height: 320 });
  await page.goto('/');
  await startRunningBlock(page);
  const host = page.getByTestId('running-term');
  await expect(host.locator('.xterm')).toBeVisible({ timeout: 5000 });

  // Emit enough rows for the block list to overflow.
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

test('output that arrives before the running block mounts does not break the first wheel scrollback', async ({ page }) => {
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

test('live output of a running block can be selected and copied', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await startRunningBlock(page);
  const host = page.getByTestId('running-term');
  await expect(host.locator('.xterm')).toBeVisible({ timeout: 5000 });
  await emitPtyOutput(page, 'live-selection-text\r\n');
  await expectAnyTermContains(page, 'live-selection-text', 3000);

  const box = (await host.locator('.xterm-screen').boundingBox())!;
  await page.mouse.move(box.x + 1, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 170, box.y + 10, { steps: 10 });
  await page.mouse.up();
  const selection = await page.evaluate(() => {
    const terms = (window as unknown as { __vrykellTerms?: Map<string, { getSelection: () => string }> }).__vrykellTerms;
    const key = [...(terms?.keys() ?? [])].find(entry => entry.startsWith('block:'));
    return key ? terms?.get(key)?.getSelection() ?? '' : '';
  });
  expect(selection).toContain('live-selection');
  await page.keyboard.press('Control+c');
  await expect.poll(() => clipboardText(page)).toContain('live-selection');
});

test('a running block does not steal the selection from completed block text', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  const input = page.getByPlaceholder(/输入命令/);
  await expect(input).toBeVisible({ timeout: 5000 });
  await input.fill('echo completed-text');
  await input.press('Enter');
  await expect(page.locator('[data-testid^="command-block-"]').filter({ hasText: 'completed-text' }).first()).toBeVisible({ timeout: 5000 });
  await startRunningBlock(page);

  const output = page.locator('[data-testid^="command-block-"]').filter({ hasText: 'completed-text' }).first()
    .locator('.command-block-output [data-selectable]').first();
  const box = (await output.boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  const selection = () => page.evaluate(() => window.getSelection()?.toString() ?? '');
  await expect.poll(selection).toContain('completed-text');
  // The idle-focus poll must not collapse the selection half a second after the drag.
  await page.waitForTimeout(1200);
  expect(await selection()).toContain('completed-text');
  // Copying a page selection is the webview's native path, so it does not pass through the
  // mocked clipboard plugin; the selection surviving is what the app must guarantee.
});

test('the block terminal matches the page color with no rounded corners and keeps clipping on the inner element', async ({ page }) => {
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
