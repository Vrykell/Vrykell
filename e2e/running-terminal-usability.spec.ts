import { test, expect } from '@playwright/test';
import { setupTauriMock, emitPtyOutput, expectAnyTermContains, ptyResizes, ptyWrites } from './tauri-mock';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await emitPtyOutput(page, '\x1b]133;E;Y2xhdWRl\x07\x1b]133;C\x07');
  await expect(page.getByTestId('running-term').locator('.xterm')).toBeVisible();
});

test('运行中命令块以图标显示统一尺寸的操作按钮', async ({ page }) => {
  const block = page.locator('[data-testid^="running-block-"]').first();
  const actions = [
    '终止命令 (Ctrl+C)',
    '结束前台应用（SIGTERM；3 秒内再点强杀 SIGKILL）',
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
  await page.screenshot({ path: test.info().outputPath('running-controls.png') });
  await block.getByRole('button', { name: '终止命令 (Ctrl+C)', exact: true }).click();
  await expect.poll(() => ptyWrites(page)).toContain('\x03');
  await block.getByRole('button', { name: '结束前台应用（SIGTERM；3 秒内再点强杀 SIGKILL）', exact: true }).click();
  await expect(block.getByRole('button', { name: '强制结束前台应用（SIGKILL）', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('termination-armed.png') });
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
