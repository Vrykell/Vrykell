import { test, expect } from '@playwright/test';
import { setupTauriMock, emitPtyOutput } from './tauri-mock';

for (const mode of ['block', 'classic'] as const) {
  test(`${mode} terminal uses the same background in both themes and custom overrides`, async ({ page }) => {
    await setupTauriMock(page);
    await page.addInitScript(openMode => {
      localStorage.setItem('vrykell-agent-settings', JSON.stringify({
        state: { global: { openModeByShell: { zsh: openMode } }, overrides: {} }, version: 8,
      }));
    }, mode);
    await page.goto('/');
    const pane = page.locator('.terminal-pane').first();
    await expect(pane).toBeVisible();
    for (const theme of ['浅色', '深色'] as const) {
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.locator('aside').getByRole('button', { name: '主题', exact: true }).click();
      await page.getByRole('button', { name: theme, exact: true }).click();
      await page.keyboard.press('Control+1');
      await expect(pane).toBeVisible();
      const expected = await page.evaluate(() => {
        const color = getComputedStyle(document.documentElement).getPropertyValue('--xterm-bg').trim();
        return `rgb(${[1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16)).join(', ')})`;
      });
      await expect(pane).toHaveCSS('background-color', expected);
      if (mode === 'block') {
        await expect(page.locator('[data-testid^="terminal-scroll-"]').first()).toHaveCSS('background-color', expected);
        await expect(page.locator('.terminal-composer').locator('..')).toHaveCSS('background-color', expected);
      }
    }
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--xterm-bg', '#213447');
      document.documentElement.style.setProperty('--canvas', '#777777');
    });
    await expect(pane).toHaveCSS('background-color', 'rgb(33, 52, 71)');
    if (mode === 'block') {
      await emitPtyOutput(page, '\x1b]133;E;ZWNobyBiYWNrZ3JvdW5k\x07\x1b]133;C\x07background-check\r\n');
      const running = page.getByTestId('running-term');
      await expect(running).toBeVisible();
      await expect(running.locator('.xterm').locator('..')).toHaveCSS('background-color', 'rgb(33, 52, 71)');
      await emitPtyOutput(page, '\x1b]133;D;0\x07');
      await expect(page.locator('[data-testid^="command-block-"]').last()).toContainText('background-check');
      await page.screenshot({ path: test.info().outputPath('block-background.png') });
    }
  });
}
