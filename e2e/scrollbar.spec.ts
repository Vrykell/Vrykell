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

async function expectNativeScrollbar(region: Locator, size = 8) {
  const style = await region.evaluate(element => {
    const scrollbar = getComputedStyle(element, '::-webkit-scrollbar');
    const thumb = getComputedStyle(element, '::-webkit-scrollbar-thumb');
    const palette = getComputedStyle(document.documentElement);
    return {
      width: scrollbar.width, height: scrollbar.height, display: scrollbar.display,
      color: thumb.backgroundColor.replace(/\s/g, ''),
      expected: palette.getPropertyValue('--scrollbar-thumb').replace(/\s/g, ''),
    };
  });
  expect(style.display).not.toBe('none');
  expect(style.width).toBe(`${size}px`);
  expect(style.height).toBe(`${size}px`);
  expect(style.color).toBe(style.expected);
}

for (const mode of ['dark', 'light'] as const) {
  test(`block history exposes a draggable scrollbar without changing output width in ${mode}`, async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
    await applyPalette(page, mode);
    const region = page.locator('[data-testid^="terminal-scroll-"]').first();
    const originalWidth = await region.evaluate(element => element.clientWidth);
    const lines = Array.from({ length: 160 }, (_, row) => `scroll-row-${row}`).join('\r\n');
    await emitPtyOutput(page, `\x1b]133;E;${btoa('scroll-history')}\x07\x1b]133;C\x07${lines}\r\n\x1b]133;D;0\x07\x1b]133;A\x07`);
    await expect(page.getByText('scroll-row-159', { exact: false }).last()).toBeVisible();
    await expectNativeScrollbar(region, 10);
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
  await expectNativeScrollbar(settings);
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
  await expectNativeScrollbar(transcript);
  await expect.poll(() => transcript.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(100);
  await page.screenshot({ path: test.info().outputPath('chat-scrollbar.png') });
});
