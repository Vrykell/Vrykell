import { test, expect, type Locator, type Page } from '@playwright/test';
import { setupTauriMock, emitPtyOutput, mockAnthropic } from './tauri-mock';
import { gotoSetting } from './settings';

async function applyPalette(page: Page, mode: 'dark' | 'light') {
  await page.evaluate(async mode => {
    const path = '/src/config/theme/tokens.ts';
    const { applyTheme } = await import(path) as typeof import('../src/config/theme/tokens');
    applyTheme(mode);
  }, mode);
}

async function expectOverlayScrollbar(page: Page, region: Locator) {
  await expect(region).toHaveClass(/overlay-scroll-target/);
  await expect(region).toHaveCSS('scrollbar-gutter', 'auto');
  expect(await region.evaluate(element => getComputedStyle(element, '::-webkit-scrollbar').display)).toBe('none');
  const id = await region.getAttribute('id');
  const bar = page.locator(`[role="scrollbar"][aria-controls="${id}"][aria-orientation="vertical"]`);
  await expect(bar).toBeVisible();
  await expect(bar).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const bounds = (await region.boundingBox())!;
  const rail = (await bar.boundingBox())!;
  expect(Math.abs(rail.x + rail.width - bounds.x - bounds.width)).toBeLessThanOrEqual(1);
}

for (const mode of ['dark', 'light'] as const) {
  test(`block backgrounds and dividers remain visible beneath the scrollbar track in ${mode}`, async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
    await page.waitForFunction(async () => {
      const path = '/src/features/terminal/stores/terminal.ts';
      const { useTerminalStore } = await import(path) as typeof import('../src/features/terminal/stores/terminal');
      return Object.values(useTerminalStore.getState().startupStates).includes('ready');
    });
    await applyPalette(page, mode);
    await page.evaluate(() => {
      const scope = window as unknown as { __vrykellSessionRegistry: {
        controllers: Map<string, import('../src/features/terminal/services/pipeline/sessionController').SessionController>;
      } };
      const controller = [...scope.__vrykellSessionRegistry.controllers.values()][0]!;
      controller.seed(Array.from({ length: 20 }, (_, index) => ({
        id: `track-${index}`, command: 'l', cwd: '~', status: 'done', exitCode: 127,
        startedAt: 0, endedAt: 50, wasLongRunning: false, outputRaw: '', outputHtml: '',
        outputText: 'bash: l: command not found', linesTruncated: 0,
      })));
    });
    const region = page.locator('[data-testid^="terminal-scroll-"]').first();
    await expect(page.getByRole('scrollbar', { name: '滚动命令历史' })).toBeVisible();
    await page.mouse.move(0, 0);
    await region.evaluate(element => { element.scrollTop = 0; });
    await expect.poll(() => region.evaluate(element => element.scrollTop)).toBe(0);
    const bounds = (await region.boundingBox())!;
    const divider = (await page.getByTestId('command-block-track-4').boundingBox())!;
    const png = await region.screenshot({ path: test.info().outputPath(`transparent-track-${mode}.png`) });
    const pixels = await page.evaluate(async ({ png, y }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const color = (x: number, row: number) => Array.from(context.getImageData(x, row, 1, 1).data).join(',');
      return {
        divider: color(image.width - 20, y), edgeDivider: color(image.width - 1, y),
        background: color(image.width - 20, y + 8), edgeBackground: color(image.width - 1, y + 8),
      };
    }, { png: png.toString('base64'), y: Math.round(divider.y - bounds.y) });
    expect(pixels.edgeDivider).toBe(pixels.divider);
    expect(pixels.edgeBackground).toBe(pixels.background);
    expect(pixels.edgeDivider).not.toBe(pixels.edgeBackground);
  });

  test(`block history exposes a draggable scrollbar without changing output width in ${mode}`, async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
    await page.waitForFunction(async () => {
      const path = '/src/features/terminal/stores/terminal.ts';
      const { useTerminalStore } = await import(path) as typeof import('../src/features/terminal/stores/terminal');
      return Object.values(useTerminalStore.getState().startupStates).includes('ready');
    });
    await applyPalette(page, mode);
    const region = page.locator('[data-testid^="terminal-scroll-"]').first();
    const originalWidth = await region.evaluate(element => element.clientWidth);
    const lines = Array.from({ length: 160 }, (_, row) => `scroll-row-${row}`).join('\r\n');
    await emitPtyOutput(page, `\x1b]133;E;${btoa('scroll-history')}\x07\x1b]133;C\x07${lines}\r\n\x1b]133;D;0\x07\x1b]133;A\x07`);
    await expect(page.getByText('scroll-row-159', { exact: false }).last()).toBeVisible();
    const bar = page.getByRole('scrollbar', { name: '滚动命令历史' });
    await expect(bar).toHaveCSS('width', '10px');
    await expect(bar).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(region).toHaveCSS('scrollbar-gutter', 'auto');
    const edges = await region.evaluate(element => ({ right: element.getBoundingClientRect().right,
      contentRight: element.firstElementChild!.getBoundingClientRect().right }));
    expect(edges.contentRight).toBe(edges.right);
    const geometry = await region.evaluate(element => ({ height: element.clientHeight, scrollHeight: element.scrollHeight, top: element.scrollTop, width: element.clientWidth }));
    expect(geometry.width).toBe(originalWidth);
    expect(geometry.scrollHeight).toBeGreaterThan(geometry.height);
    const bounds = (await region.boundingBox())!;
    const thumbHeight = Math.max(28, geometry.height * geometry.height / geometry.scrollHeight);
    const thumbTop = (geometry.height - thumbHeight) * geometry.top / (geometry.scrollHeight - geometry.height);
    await page.mouse.move(bounds.x + bounds.width - 5, bounds.y + thumbTop + thumbHeight / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width - 5, bounds.y + 24, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => region.evaluate(element => element.scrollTop)).toBeLessThan(geometry.top - 100);
    await bar.focus();
    await bar.press('Home');
    await expect(bar).toHaveCSS('outline-style', 'none');
    await expect.poll(() => region.evaluate(element => element.scrollTop)).toBe(0);
    await bar.press('End');
    await expect.poll(() => region.evaluate(element => element.scrollTop)).toBe(geometry.scrollHeight - geometry.height);
    await page.screenshot({ path: test.info().outputPath(`scrollbar-${mode}.png`) });
  });
}

test('completed wide output follows the window width without a horizontal scrollbar', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  // Wait for the startup prompt before injecting command output.
  await page.waitForFunction(async () => {
    const path = '/src/features/terminal/stores/terminal.ts';
    const { useTerminalStore } = await import(path) as typeof import('../src/features/terminal/stores/terminal');
    return Object.values(useTerminalStore.getState().startupStates).includes('ready');
  });
  await emitPtyOutput(page, `\x1b]133;E;${btoa('wide-table')}\x07\x1b]133;C\x07${'wide-column '.repeat(8)}\r\n\x1b]133;D;0\x07\x1b]133;A\x07`);
  const output = page.locator('[data-testid^="command-block-"] [data-selectable]').last();
  await expect(output).toContainText('wide-column');
  const height = await output.evaluate(element => element.clientHeight);
  await page.setViewportSize({ width: 850, height: 800 });
  await output.scrollIntoViewIfNeeded();
  await expect.poll(() => output.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await expect.poll(() => output.evaluate(element => element.clientHeight)).toBeGreaterThan(height);
  expect(await output.evaluate(element => getComputedStyle(element).overflowX)).toBe('hidden');
  await page.setViewportSize({ width: 1240, height: 800 });
  await expect.poll(() => output.evaluate(element => element.clientHeight)).toBe(height);
});

test('classic terminal retains its native themed scrollbar and drag navigation', async ({ page }) => {
  await setupTauriMock(page, { integration: false });
  await page.addInitScript(() => localStorage.setItem('vrykell-agent-settings', JSON.stringify({
    version: 8, state: { global: { openModeByShell: { zsh: 'classic' } }, overrides: {} },
  })));
  await page.goto('/');
  const terminal = page.locator('.xterm').first();
  await expect(terminal).toBeVisible();
  await emitPtyOutput(page, Array.from({ length: 200 }, (_, row) => `classic-row-${row}\r\n`).join(''));
  const viewport = () => page.evaluate(() => {
    const scope = window as unknown as { __vrykellTerms: Map<string, import('@xterm/xterm').Terminal> };
    const term = [...scope.__vrykellTerms.values()][0]!;
    const buffer = term.buffer.active;
    return { top: buffer.viewportY, lastLine: buffer.getLine(buffer.viewportY + term.rows - 2)?.translateToString(true) ?? '' };
  });
  await expect.poll(() => viewport().then(value => value.lastLine)).toBe('classic-row-199');
  const originalTop = (await viewport()).top;
  await terminal.hover();
  const slider = terminal.locator('.scrollbar.vertical > .slider');
  await expect(slider).toBeVisible();
  const bar = terminal.locator('.scrollbar.vertical');
  await expect(bar).toHaveCSS('width', '10px');
  await expect(slider).toHaveCSS('width', '10px');
  const pane = page.locator('.terminal-pane:visible');
  const paneBounds = (await pane.boundingBox())!;
  const barBounds = (await bar.boundingBox())!;
  expect(Math.abs(barBounds.x + barBounds.width - paneBounds.x - paneBounds.width)).toBeLessThanOrEqual(1);
  await expect.poll(() => bar.evaluate(element => getComputedStyle(element).opacity)).toBe('1');
  const bounds = (await slider.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y - 120, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => viewport().then(value => value.top)).toBeLessThan(originalTop);
  await page.locator('[data-dock-btn="chat"]').click();
  await page.setViewportSize({ width: 900, height: 800 });
  await expect.poll(async () => {
    const right = (await bar.boundingBox())!;
    const container = (await pane.boundingBox())!;
    return Math.abs(right.x + right.width - container.x - container.width);
  }).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => {
    const scope = window as unknown as { __vrykellTerms: Map<string, import('@xterm/xterm').Terminal> };
    const theme = [...scope.__vrykellTerms.values()][0]!.options.theme!;
    return theme.overviewRulerBorder === theme.background;
  })).toBe(true);
  await page.screenshot({ path: test.info().outputPath('classic-scrollbar.png') });
});

test('settings and long chat transcripts share visible themed scrollbars', async ({ page }) => {
  await setupTauriMock(page);
  await mockAnthropic(page, Array.from({ length: 100 }, (_, row) => `对话内容第 ${row} 行。`).join('\n\n'));
  await page.goto('/');
  await gotoSetting(page, '模型行为');
  await page.setViewportSize({ width: 1240, height: 500 });
  const settings = page.locator('.settings-content');
  await expectOverlayScrollbar(page, settings);
  await expect.poll(() => settings.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(100);
  await settings.hover();
  await page.mouse.wheel(0, 400);
  await expect.poll(() => settings.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press('Meta+1');
  await page.locator('[data-dock-btn="chat"]').click();
  await page.getByPlaceholder(/自然语言描述/).fill('测试长对话');
  await page.getByPlaceholder(/自然语言描述/).press('Enter');
  await expect(page.getByText('对话内容第 99 行。', { exact: true })).toBeVisible();
  const transcript = page.locator('.workspace-side-panel[data-side="right"] .scroll-region');
  await expectOverlayScrollbar(page, transcript);
  await expect.poll(() => transcript.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(100);
  await page.screenshot({ path: test.info().outputPath('chat-scrollbar.png') });
});
