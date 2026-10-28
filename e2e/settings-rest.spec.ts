/**
 * Theme / opening mode / keyboard shortcuts / web search / permissions settings pages e2e.
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock, themeConfig, aiKeyCalls } from './tauri-mock';
import { gotoSetting, fieldOf, rowOf } from './settings';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
});

test.describe('Theme settings page', () => {
  test('Dark/light toggle updates data-theme', async ({ page }) => {
    await gotoSetting(page, '主题');
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(theme).toBe('dark');
    await page.getByRole('radio', { name: '浅色' }).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe('light');
    await page.getByRole('radio', { name: '深色' }).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe('dark');
  });

  test('Three theme mode previews sit in one row and follow the system color scheme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await gotoSetting(page, '主题');
    const group = page.getByRole('radiogroup', { name: '主题模式' });
    await expect(group.getByRole('radio')).toHaveCount(3);
    await group.getByRole('radio', { name: '跟随系统', exact: true }).click();
    // One row: every option shares the same vertical position.
    const tops = await group.getByRole('radio')
      .evaluateAll(elements => elements.map(element => Math.round(element.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    await expect(group.locator('.theme-mode-preview')).toHaveCount(3);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('Opacity slider updates the backend config and percentage display', async ({ page }) => {
    await gotoSetting(page, '主题');
    const slider = page.locator('input[type="range"]');
    await expect(page.getByText('100%')).toBeVisible();
    await slider.fill('0.65');
    await expect(page.getByText('65%')).toBeVisible({ timeout: 3000 });
    const cfg = await themeConfig(page);
    expect(cfg.opacity).toBeCloseTo(0.65, 1);
    // The floor keeps the content readable: Home moves the slider to its minimum.
    await slider.focus();
    await page.keyboard.press('Home');
    await expect(page.getByText('50%')).toBeVisible({ timeout: 3000 });
    expect((await themeConfig(page)).opacity).toBeCloseTo(0.5, 1);
  });
});

test.describe('Theme file settings page', () => {
  test('Config file path is shown and reloading reports no error', async ({ page }) => {
    await gotoSetting(page, '主题文件');
    await expect(page.getByText('/home/e2e/.vrykell/theme.json')).toBeVisible();
    await page.getByRole('button', { name: /重新加载/ }).click();
    await page.getByRole('button', { name: /导出主题/ }).click();
  });
});

test.describe('Opening mode settings page', () => {
  test('Each shell defaults to block mode; switching to classic mode persists', async ({ page }) => {
    await gotoSetting(page, 'Zsh');
    await page.getByRole('combobox', { name: '打开方式', exact: true }).click();
    await page.getByRole('option', { name: '经典模式', exact: true }).click();
    const saved = await page.evaluate(() => localStorage.getItem('vrykell-agent-settings') ?? '');
    expect(saved).toContain('"zsh":"classic"');
  });

  test('SSH opening mode is configured through the saved host quick menu', async ({ page }) => {
    await page.getByTestId('tab-new-btn').click();
    await page.getByTestId('new-tab-option-ssh:ssh-1').click({ button: 'right' });
    await page.getByRole('menuitem', { name: '打开方式', exact: true }).press('ArrowRight');
    await expect(page.getByRole('menuitemradio', { name: '经典模式' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('menuitemradio', { name: '块模式' }).click();
    const saved = await page.evaluate(() => localStorage.getItem('vrykell-agent-settings') ?? '');
    expect(saved).toContain('"sshOpenMode":"block"');
  });
});

test.describe('Keyboard shortcuts page', () => {
  test('Lists all keyboard shortcuts', async ({ page }) => {
    await gotoSetting(page, '快捷键说明');
    await expect(page.getByText('新建标签页')).toBeVisible();
    await expect(page.getByText('全局搜索')).toBeVisible();
    await expect(page.getByText('打开设置')).toBeVisible();
    // Shortcut badges follow the platform modifier the app advertises.
    const mod = await page.evaluate(() => /Mac/.test(navigator.userAgent) ? 'Meta' : 'Control');
    await expect(page.getByLabel(`${mod}+T`, { exact: true })).toBeVisible();
    await expect(page.locator('.settings-screen').getByLabel(`${mod}+F`, { exact: true })).toBeVisible();
  });
});

test.describe('Web search page', () => {
  test('Shows the search method and saves/clears the Tavily key', async ({ page }) => {
    await gotoSetting(page, '联网搜索');
    await expect(page.getByText('备用搜索', { exact: true })).toBeVisible();
    await expect(page.getByText('未配置', { exact: true })).toBeVisible();

    const keyField = fieldOf(page, 'Tavily API Key');
    await keyField.getByPlaceholder(/输入 Tavily API Key/).fill('tv-e2e');
    await expect(page.locator('.settings-page-header').getByRole('status')).toHaveText('已保存');
    await expect(page.getByText('已配置', { exact: true })).toBeVisible();
    const calls = await aiKeyCalls(page);
    expect(calls.some((c) => c.provider === 'tavily' && c.key === 'tv-e2e')).toBe(true);

    await keyField.getByRole('button', { name: '清除' }).click();
    await expect(page.getByText('已清除 Tavily Key')).toBeVisible();
    await expect(keyField.getByText('未配置', { exact: true })).toBeVisible();
  });
});

test.describe('Model permissions page', () => {
  test('Tool permission levels switch and persist', async ({ page }) => {
    await gotoSetting(page, '工具权限');
    // Run terminal commands → deny
    const runRow = rowOf(page, '执行终端命令');
    await runRow.getByRole('combobox', { name: '执行终端命令 权限' }).click();
    await page.getByRole('option', { name: '禁止', exact: true }).click();
    let saved = await page.evaluate(() => localStorage.getItem('vrykell-permissions') ?? '');
    expect(saved).toContain('"run_command":"deny"');
    // Web search → ask every time
    const webRow = rowOf(page, '联网搜索');
    await webRow.getByRole('combobox', { name: '联网搜索 权限' }).click();
    await page.getByRole('option', { name: '每次询问', exact: true }).click();
    saved = await page.evaluate(() => localStorage.getItem('vrykell-permissions') ?? '');
    expect(saved).toContain('"web_search":"ask"');
  });

  test('Clear session grants button reports success', async ({ page }) => {
    await gotoSetting(page, '工具权限');
    await page.getByRole('button', { name: '清空会话授权' }).click();
    await expect(page.getByText('已清空全部会话授权')).toBeVisible();
  });
});
