import { test, expect } from '@playwright/test';
import { setupTauriMock, emitPtyOutput, expectAnyTermContains, ptyResizes, ptyWrites } from './tauri-mock';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await emitPtyOutput(page, '\x1b]133;E;Y2xhdWRl\x07\x1b]133;C\x07');
  await expect(page.getByTestId('running-term').locator('.xterm')).toBeVisible();
});

test('running controls have readable labels, larger targets and distinct actions', async ({ page }) => {
  const block = page.locator('[data-testid^="running-block-"]').first();
  for (const label of ['中断', '结束', '全屏']) {
    const button = block.getByRole('button', { name: label, exact: true });
    const bounds = (await button.boundingBox())!;
    expect(bounds.width).toBeGreaterThanOrEqual(30);
    expect(bounds.height).toBeGreaterThanOrEqual(30);
    await expect(button.locator('svg')).toHaveCSS('width', '18px');
  }
  await page.screenshot({ path: test.info().outputPath('running-controls.png') });
  await block.getByRole('button', { name: '中断', exact: true }).click();
  await expect.poll(() => ptyWrites(page)).toContain('\x03');
  await block.getByRole('button', { name: '结束', exact: true }).click();
  await expect(block.getByRole('button', { name: '强制结束', exact: true })).toBeVisible();
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
