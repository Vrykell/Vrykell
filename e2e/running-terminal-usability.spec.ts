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
  await expect(block.locator('.command-block-info')).toHaveCSS('opacity', '0');
  await block.hover();
  await expect(block.locator('.command-block-info')).toHaveCSS('opacity', '1');
  const actions = [
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

test('运行中块不再叠加第二个 xterm 滚动条', async ({ page }) => {
  const host = page.getByTestId('running-term');
  await expect(host.locator('.xterm-viewport')).toHaveCSS('overflow-y', 'hidden');
  await expect(host.locator('.xterm-scrollable-element > .scrollbar.vertical')).toHaveCSS('display', 'none');
  await expect(host.locator('.xterm-scrollable-element > .scrollbar.horizontal')).toHaveCSS('display', 'none');
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
    await emitPtyOutput(page, '\x1b[H\x1b[2Jrepainting-' + character);
    await expectAnyTermContains(page, 'repainting-' + character);
    expect((await host.boundingBox())!.height).toBe(initialHeight);
    expect((await block.boundingBox())!.y).toBe(initialTop);
    expect(await scroll.evaluate(element => element.scrollTop)).toBe(initialScrollTop);
    await emitPtyOutput(page, '\x1b[20;1Hinput-ready-' + character);
    await expectAnyTermContains(page, 'input-ready-' + character);
    expect((await host.boundingBox())!.height).toBe(initialHeight);
    expect((await block.boundingBox())!.y).toBe(initialTop);
  }
  expect((await ptyResizes(page)).length).toBe(resizes);
  await page.screenshot({ path: test.info().outputPath('stable-interactive-input.png') });
});
