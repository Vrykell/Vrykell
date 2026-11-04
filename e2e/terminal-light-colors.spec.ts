import { expect, test } from '@playwright/test';
import { emitPtyOutput, setupTauriMock } from './tauri-mock';

for (const renderer of ['dom', 'webgl']) test(`light ${renderer} keeps shell white and bright-white input visible`, async ({ page }, info) => {
  await setupTauriMock(page, { integration: false });
  await page.addInitScript(renderer => {
    localStorage.setItem('vrykell-theme-mode', 'light');
    localStorage.setItem('vrykell-agent-settings', JSON.stringify({ version: 8, state: { global: { openModeByShell: { zsh: 'classic', bash: 'classic' } }, overrides: {} } }));
    localStorage.setItem('vrykell-typography', JSON.stringify({ state: { terminalRenderer: renderer } }));
  }, renderer);
  await page.goto('/');
  const terminal = page.locator('.xterm:visible').first();
  await expect(terminal).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __PTY_SPAWNS__: unknown[] }).__PTY_SPAWNS__.length)).toBeGreaterThan(0);
  await emitPtyOutput(page, '\r\u001b[2KPS C:\\Users\\test> \u001b[33mcd \u001b[37mD:\\projects \u001b[97mpath-white\u001b[0m');
  const read = () => page.evaluate(() => {
    const terms = (window as unknown as { __vrykellTerms: Map<string, import('@xterm/xterm').Terminal> }).__vrykellTerms;
    const term = [...terms.values()][0]!;
    const buffer = term.buffer.active;
    return { line: Array.from({ length: buffer.length }, (_, row) => buffer.getLine(row)?.translateToString(true) ?? '').join(''), white: term.options.theme?.white, brightWhite: term.options.theme?.brightWhite };
  });
  await expect.poll(read).toMatchObject({ line: expect.stringContaining('D:\\projects path-white'), white: '#41454D', brightWhite: '#242B30' });
  for (const width of [760, 1240]) {
    await page.setViewportSize({ width, height: 800 });
    await terminal.screenshot({ path: info.outputPath(`light-shell-${renderer}-${width}.png`), animations: 'disabled' });
  }
  await page.evaluate(async () => {
    const path = '/src/features/settings/model/terminalTheme.ts';
    const { applyTerminalTheme, useTerminalThemeStore } = await import(path) as typeof import('../src/features/settings/model/terminalTheme');
    applyTerminalTheme(useTerminalThemeStore.getState().config, 'dark');
  });
  await expect.poll(read).toMatchObject({ white: '#D6D9E0', brightWhite: '#F3F5F8' });
});
