import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test('all text surfaces retain literal input and settings search focuses an individual control', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  const command = page.getByPlaceholder('输入命令…');
  await command.fill('npm list');
  await expect(command).toHaveValue('npm list');
  await page.getByTestId('global-search-trigger').click();
  const dialog = page.getByRole('dialog', { name: '全局搜索' });
  const search = dialog.getByRole('textbox', { name: '搜索工作区' });
  await search.fill('终端字号');
  await dialog.locator('[data-search-result]').filter({ hasText: '终端字号' }).first().click();
  await expect(page.getByRole('combobox', { name: '终端字号', exact: true })).toBeFocused();
  await expect(page.locator('.settings-field[data-setting-title="终端字号"]')).not.toHaveAttribute('data-search-target');
  for (const input of await page.locator('input:not([type="checkbox"]):not([type="radio"]), textarea').all()) {
    await expect(input).toHaveAttribute('autocorrect', 'off');
    await expect(input).toHaveAttribute('autocapitalize', 'off');
    await expect(input).toHaveAttribute('spellcheck', 'false');
  }
  await page.screenshot({ path: test.info().outputPath('setting-search-destination.png'), animations: 'disabled' });
  await page.getByTestId('global-search-trigger').click();
  await search.fill('补全防抖');
  await dialog.locator('[data-search-result]').filter({ hasText: '补全防抖' }).first().click();
  const field = page.locator('.settings-field[data-setting-title="补全防抖"]');
  await expect(field).not.toHaveAttribute('data-search-target');
  await expect(field.locator('input')).toBeFocused();
  await page.getByTestId('global-search-trigger').click();
  await search.fill('执行终端命令');
  await dialog.locator('[data-search-result]').filter({ hasText: '执行终端命令' }).first().click();
  await expect(page.getByRole('combobox', { name: '执行终端命令 权限', exact: true })).toBeFocused();
  await page.getByTestId('global-search-trigger').click();
  await search.fill('Zsh 打开模式');
  await dialog.locator('[data-search-result]').filter({ hasText: 'Zsh 打开模式' }).first().click();
  await expect(page.getByRole('combobox', { name: 'Zsh 打开模式', exact: true })).toBeFocused();
});

test('classic terminal input helpers remain invisible and selected cells have no ruler seam after resizing', async ({ page }) => {
  await setupTauriMock(page, { integration: false });
  await page.addInitScript(() => localStorage.setItem('vrykell-agent-settings', JSON.stringify({
    version: 8, state: { global: { openModeByShell: { zsh: 'classic' } }, overrides: {} },
  })));
  await page.goto('/');
  const terminal = page.locator('.xterm:visible').first();
  await expect(terminal).toBeVisible();
  const input = terminal.locator('.xterm-helper-textarea');
  await expect(input).toHaveAttribute('autocorrect', 'off');
  await expect(input).toHaveCSS('opacity', '0');
  await input.focus();
  await page.keyboard.insertText('npm list');
  await expect(input).toHaveCSS('opacity', '0');
  for (const width of [720, 1240, 1550]) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate(() => {
      const terms = (window as unknown as { __vrykellTerms: Map<string, import('@xterm/xterm').Terminal> }).__vrykellTerms;
      const term = [...terms.values()][0]!;
      term.select(0, 0, term.cols * 3);
    });
    await expect(terminal.locator('.xterm-decoration-overview-ruler')).toHaveCSS('display', 'none');
    await terminal.screenshot({ path: test.info().outputPath(`classic-selection-${width}.png`), animations: 'disabled' });
  }
});
