import { test, expect } from '@playwright/test';
import { setupTauriMock, emitPtyOutput, expectAnyTermContains, ptyResizes, ptyWrites } from './tauri-mock';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  // Inject the command only after the mock shell has finished its startup prompt.
  await page.waitForFunction(async () => {
    const path = '/src/features/terminal/stores/terminal.ts';
    const { useTerminalStore } = await import(path) as typeof import('../src/features/terminal/stores/terminal');
    return Object.values(useTerminalStore.getState().startupStates).includes('ready');
  });
  await emitPtyOutput(page, '\x1b]133;E;Y2xhdWRl\x07\x1b]133;C\x07');
  await expect(page.getByTestId('running-term').locator('.xterm')).toBeVisible();
});

test('运行中命令块以图标显示统一尺寸的操作按钮', async ({ page }) => {
  const block = page.locator('[data-testid^="running-block-"]').first();
  await page.mouse.move(0, 0);
  await expect(block.locator('.command-block-info')).toHaveCSS('opacity', '1');
  await expect(block.locator('.command-block-info')).toHaveCSS('padding-right', '112px');
  await expect(block.locator('.command-status-duration')).toBeVisible();
  await expect(block.locator('.command-block-actions')).toHaveCSS('opacity', '0');
  await block.hover();
  await expect(block.locator('.command-block-actions')).toHaveCSS('opacity', '1');
  const actions = [
    '重绘终端',
    '终止命令',
    '结束前台应用',
    '进入全屏交互',
  ];
  for (const label of actions) {
    const button = block.getByRole('button', { name: label, exact: true });
    const bounds = (await button.boundingBox())!;
    expect(bounds.width).toBe(28);
    expect(bounds.height).toBe(28);
    await expect(button.locator('svg')).toHaveCSS('width', '16px');
    await expect(button).toHaveText('');
  }
  const interrupt = block.getByRole('button', { name: '终止命令', exact: true });
  await interrupt.hover();
  const hint = page.getByTestId('app-tooltip');
  await expect(hint).toContainText('终止命令');
  await expect(hint.getByLabel('Control+C')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('running-controls.png') });
  await block.getByRole('button', { name: '终止命令', exact: true }).click();
  await expect.poll(() => ptyWrites(page)).toContain('\x03');
  await block.getByRole('button', { name: '结束前台应用', exact: true }).click();
  await expect(block.getByRole('button', { name: '强制结束前台应用', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('termination-armed.png') });
});

test('运行中块右键菜单前置工具栏快捷操作并可直接触发', async ({ page }) => {
  const block = page.locator('[data-testid^="running-block-"]').first();
  await block.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: '操作菜单' });
  await expect(menu).toBeVisible();

  // The toolbar actions come first, then copy/paste and the pane actions.
  const labels = ['重绘终端', '终止命令', '结束前台应用', '进入全屏交互', '复制', '粘贴', '分裂终端（选位置）'];
  for (const [index, label] of labels.entries()) {
    await expect(menu.getByRole('button').nth(index)).toContainText(label);
  }
  await expect(menu.getByLabel('Control+C').first()).toBeVisible();

  // Interrupt runs the same write the toolbar performs and closes the menu.
  const before = (await ptyWrites(page)).length;
  await menu.getByRole('button', { name: '终止命令' }).click();
  await expect.poll(async () => (await ptyWrites(page)).slice(before)).toContain('\x03');
  await expect(menu).toHaveCount(0);

  // The menu can raise the manual fullscreen surface as well.
  await block.click({ button: 'right' });
  await menu.getByRole('button', { name: '进入全屏交互' }).click();
  await expect(page.getByTestId('tui-fullscreen')).toBeVisible();
  await page.locator('[data-tip="退出全屏"]').click();
  await expect(page.getByTestId('tui-fullscreen')).toHaveCount(0);
});

test('运行中块不再叠加第二个 xterm 滚动条', async ({ page }) => {
  const host = page.getByTestId('running-term');
  await expect(host.locator('.xterm-viewport')).toHaveCSS('overflow-y', 'hidden');
  await expect(host.locator('.xterm-scrollable-element > .scrollbar.vertical')).toHaveCSS('display', 'none');
  await expect(host.locator('.xterm-scrollable-element > .scrollbar.horizontal')).toHaveCSS('display', 'none');
});

test('运行块在重画为更小帧后收敛高度，不再留下整屏黑尾', async ({ page }) => {
  const block = page.locator('[data-testid^="running-block-"]').first();
  await emitPtyOutput(page, Array.from({ length: 30 }, (_, index) => `frame row ${index}`).join('\r\n') + '\r\n');
  await expect.poll(async () => (await block.boundingBox())!.height).toBeGreaterThan(200);
  const tallHeight = (await block.boundingBox())!.height;
  // A TUI rewrites itself into fewer rows (as after a resize): the block settles to the smaller
  // frame instead of keeping the old height as a black tail under the content. Split repaint
  // frames are covered by the typing test above; this only pins the settle result.
  await emitPtyOutput(page, '\x1b[2J\x1b[H' + 'short frame 1\r\nshort frame 2\r\nshort frame 3\r\n');
  await expect.poll(async () => (await block.boundingBox())!.height).toBeLessThan(tallHeight - 100);
});

test('重绘循环的中间态不会让运行块高度来回跳', async ({ page }) => {
  const block = page.locator('[data-testid^="running-block-"]').first();
  const frame = Array.from({ length: 24 }, (_, index) => `frame row ${index}`).join('\r\n') + '\r\n';
  await emitPtyOutput(page, frame);
  await expect.poll(async () => (await block.boundingBox())!.height).toBeGreaterThan(150);
  const tallHeight = (await block.boundingBox())!.height;
  // A TUI repaint erases and redraws: between the two writes the measurement reads small.
  // Sample per frame while several repaint cycles land to pin that the block never adopts them.
  await page.evaluate(() => {
    const element = document.querySelector<HTMLElement>('[data-testid^="running-block-"]')!;
    const samples: number[] = [];
    (window as unknown as Record<string, unknown>).__repaintHeightSamples = samples;
    const step = () => { samples.push(element.getBoundingClientRect().height); if (samples.length < 80) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
  for (let cycle = 0; cycle < 3; cycle++) {
    await emitPtyOutput(page, '\x1b[2J\x1b[H');
    await page.waitForTimeout(120);
    await emitPtyOutput(page, '\x1b[H' + frame);
    await page.waitForTimeout(130);
  }
  const samples = await page.evaluate(() => (window as unknown as { __repaintHeightSamples: number[] }).__repaintHeightSamples);
  expect(Math.min(...samples)).toBeGreaterThan(tallHeight - 1);
  expect((await block.boundingBox())!.height).toBe(tallHeight);
});

test('split repaint frames during typing do not shrink the running terminal or resend its size', async ({ page }) => {
  const host = page.getByTestId('running-term');
  await emitPtyOutput(page, '\x1b[20;1Hinput-ready');
  await expectAnyTermContains(page, 'input-ready');
  const initialHeight = (await host.boundingBox())!.height;
  const block = page.locator('[data-testid^="running-block-"]').first();
  const initialTop = (await block.boundingBox())!.y;
  const scroll = page.locator('[data-testid^="terminal-scroll-"]').first();
  const initialScrollTop = await scroll.evaluate(element => element.scrollTop);
  await expect.poll(async () => (await ptyResizes(page)).length).toBeGreaterThan(0);
  const resizes = (await ptyResizes(page)).length;
  for (const character of ['a', 'b', 'c']) {
    await host.locator('.xterm-helper-textarea').press(character);
    await expect.poll(() => ptyWrites(page)).toContain(character);
    // Sample the height per frame while a transient small repaint is followed by the real frame
    // with its input line: the block must never visibly collapse, and the layout below must stay.
    await page.evaluate(() => {
      const element = document.querySelector<HTMLElement>('[data-testid="running-term"]')!;
      const samples: number[] = [];
      (window as unknown as Record<string, unknown>).__runningHeightSamples = samples;
      const step = () => { samples.push(element.getBoundingClientRect().height); if (samples.length < 30) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
    await emitPtyOutput(page, '\x1b[H\x1b[2Jrepainting-' + character);
    await emitPtyOutput(page, '\x1b[20;1Hinput-ready-' + character);
    await expectAnyTermContains(page, 'input-ready-' + character);
    expect((await host.boundingBox())!.height).toBe(initialHeight);
    expect((await block.boundingBox())!.y).toBe(initialTop);
    expect(await scroll.evaluate(element => element.scrollTop)).toBe(initialScrollTop);
    const samples = await page.evaluate(() => (window as unknown as { __runningHeightSamples: number[] }).__runningHeightSamples);
    expect(Math.min(...samples)).toBe(initialHeight);
  }
  expect((await ptyResizes(page)).length).toBe(resizes);
  await page.screenshot({ path: test.info().outputPath('stable-interactive-input.png') });
});
