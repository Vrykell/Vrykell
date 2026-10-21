import { expect, test, type Page } from '@playwright/test';
import { emitPtyOutput, expectAnyTermContains, ptyResizes, ptyWrites, setupTauriMock } from './tauri-mock';

async function greenPixels(page: Page, pixels: Buffer) {
  return page.evaluate(async png => {
    const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) if (pixels[index + 1]! > pixels[index]! * 1.4 && pixels[index + 1]! > 70) count++;
    return count;
  }, pixels.toString('base64'));
}

async function startRunning(page: Page, manual: boolean) {
  await setupTauriMock(page, { schedulesSeed: [] });
  await page.setViewportSize({ width: 1240, height: 800 });
  await page.goto('/');
  await expect(page.locator('[data-terminal-input]')).toBeVisible();
  await page.waitForFunction(async () => {
    const path = '/src/features/terminal/stores/terminal.ts';
    const { useTerminalStore } = await import(path) as typeof import('../src/features/terminal/stores/terminal');
    return Object.values(useTerminalStore.getState().startupStates).includes('ready');
  });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await emitPtyOutput(page, `\x1b]133;E;${btoa('tail -f live.log')}\x07\x1b]133;C\x07`);
  await expect(page.getByTestId('running-term').locator('.xterm')).toBeVisible();
  if (manual) {
    await page.locator('[data-testid^="running-block-"]').first().hover();
    await page.locator('[data-tip="进入全屏交互"]').click();
    await expect(page.getByTestId('tui-fullscreen').locator('.xterm-screen')).toBeVisible();
  } else {
    await emitPtyOutput(page, '\x1b[?1049h');
    await expect(page.getByTestId('tui-banner')).toBeVisible();
  }
  await emitPtyOutput(page, '\x1b[H\x1b[32mLOG_MARKER_ROW\x1b[0m\r\n');
  await expectAnyTermContains(page, 'LOG_MARKER_ROW');
}

for (const scale of [1, 1.25]) test.describe(`fullscreen at scale ${scale}`, () => {
  test.use({ deviceScaleFactor: scale });

  test('returning to a manual fullscreen command restores its painted surface and input', async ({ page }) => {
    await startRunning(page, true);
    const original = await page.evaluate(async () => {
      const path = '/src/features/workspace/stores/workspace.ts';
      const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
      const terms = (window as unknown as { __vrykellTerms: Map<string, import('@xterm/xterm').Terminal>; __savedLiveTerminal?: import('@xterm/xterm').Terminal }).__vrykellTerms;
      const scope = window as unknown as { __savedLiveTerminal?: import('@xterm/xterm').Terminal };
      const pane = document.querySelector<HTMLElement>('[data-testid="tui-fullscreen"]')!.dataset.paneId!;
      scope.__savedLiveTerminal = terms.get(`block:${pane}`);
      return { tab: useWorkspaceStore.getState().activeId, pane };
    });
    const screen = page.getByTestId('tui-fullscreen').locator('.xterm-screen');
    const box = (await screen.boundingBox())!;
    const clip = { x: box.x, y: box.y, width: 80, height: 16 };
    await page.screenshot({ path: test.info().outputPath('fullscreen-before.png'), animations: 'disabled' });
    await expect.poll(async () => greenPixels(page, await page.screenshot({ clip, animations: 'disabled' }))).toBeGreaterThan(5);
    const pixels = await page.screenshot({ clip, animations: 'disabled' });
    await page.evaluate(async () => {
      const path = '/src/features/workspace/stores/workspace.ts';
      const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
      useWorkspaceStore.getState().addTab();
    });
    await expect(page.getByTestId('tui-fullscreen')).toHaveCount(0);
    await page.locator(`[data-tab-row-id="${original.tab}"]`).click();
    await expect(page.getByTestId('tui-fullscreen')).toHaveAttribute('data-pane-id', original.pane);
    await expect(screen).toBeVisible();
    await expect.poll(() => page.screenshot({ clip, animations: 'disabled' })).toEqual(pixels);
    expect(await page.evaluate(({ pane }) => {
      const scope = window as unknown as { __vrykellTerms: Map<string, import('@xterm/xterm').Terminal>; __savedLiveTerminal?: import('@xterm/xterm').Terminal };
      return scope.__vrykellTerms.get(`block:${pane}`) === scope.__savedLiveTerminal;
    }, original)).toBe(true);
    const before = (await ptyWrites(page)).length;
    await expect(page.getByTestId('tui-fullscreen').locator('textarea')).toBeFocused();
    await page.keyboard.type('z');
    await expect.poll(async () => (await ptyWrites(page)).slice(before).join('')).toBe('z');
    await page.screenshot({ path: test.info().outputPath('fullscreen-restored.png'), animations: 'disabled' });
  });

  for (const manual of [true, false]) test(`${manual ? 'manual' : 'alternate'} fullscreen keeps one stable grid during continuous width changes`, async ({ page }) => {
    await startRunning(page, manual);
    const screen = manual ? page.getByTestId('tui-fullscreen').locator('.xterm-screen') : page.locator('.terminal-pane .xterm-screen:visible');
    let box = (await screen.boundingBox())!;
    let clip = { x: box.x, y: box.y, width: 80, height: 16 };
    try {
      await expect.poll(async () => {
        box = (await screen.boundingBox())!;
        clip = { x: box.x, y: box.y, width: 80, height: 16 };
        return greenPixels(page, await page.screenshot({ clip, animations: 'disabled' }));
      }).toBeGreaterThan(5);
    } finally {
      await page.screenshot({ path: test.info().outputPath(`${manual ? 'manual' : 'alternate'}-before-resize.png`), animations: 'disabled' });
    }
    const pixels = await page.screenshot({ clip, animations: 'disabled' });
    const readings: { cols: number; rows: number; offset: number; width: number }[] = [];
    await page.evaluate(manual => {
      const scope = window as unknown as { __vrykellTerms: Map<string, import('@xterm/xterm').Terminal>; __resizeGrids: { cols: number; rows: number }[] };
      scope.__resizeGrids = [];
      const entry = [...scope.__vrykellTerms].find(([key]) => key.startsWith('block:') === manual)!;
      entry[1].onResize(size => scope.__resizeGrids.push(size));
    }, manual);
    for (let width = 1240; width >= 960; width -= 10) {
      await page.setViewportSize({ width, height: 800 });
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      expect(await page.screenshot({ clip, animations: 'disabled' })).toEqual(pixels);
      readings.push(await screen.evaluate((element, manual) => {
        const host = element.closest(manual ? '[data-testid="tui-fullscreen"]' : '.terminal-pane')!;
        const scope = window as unknown as { __vrykellTerms: Map<string, import('@xterm/xterm').Terminal> };
        const term = [...scope.__vrykellTerms].find(([key]) => key.startsWith('block:') === manual)![1];
        return { cols: term.cols, rows: term.rows, offset: element.getBoundingClientRect().left - host.getBoundingClientRect().left, width: element.getBoundingClientRect().width };
      }, manual));
    }
    const grids = await page.evaluate(() => (window as unknown as { __resizeGrids: { cols: number; rows: number }[] }).__resizeGrids);
    expect(grids.length).toBeGreaterThan(10);
    expect(new Set(grids.map(size => size.rows)).size).toBe(1);
    for (let index = 1; index < grids.length; index++) expect(grids[index]!.cols).toBeLessThanOrEqual(grids[index - 1]!.cols);
    for (let index = 1; index < readings.length; index++) expect(readings[index]!.width).toBeLessThanOrEqual(readings[index - 1]!.width);
    expect(Math.max(...readings.map(size => size.offset)) - Math.min(...readings.map(size => size.offset))).toBeLessThanOrEqual(.5);
    const final = readings.at(-1)!;
    await expect.poll(async () => (await ptyResizes(page)).at(-1)).toMatchObject({ cols: final.cols, rows: final.rows });
    await expectAnyTermContains(page, 'LOG_MARKER_ROW');
    await page.screenshot({ path: test.info().outputPath(`${manual ? 'manual' : 'alternate'}-resized.png`), animations: 'disabled' });
  });
});
