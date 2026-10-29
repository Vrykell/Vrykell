/**
 * Theme / opening mode / keyboard shortcuts / web search / permissions settings pages e2e.
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock, themeConfig, aiKeyCalls } from './tauri-mock';
import { gotoSetting, fieldOf, rowOf, selectThemeMode } from './settings';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
});

test.describe('Theme settings page', () => {
  test('Dark/light toggle updates data-theme', async ({ page }) => {
    await gotoSetting(page, '主题');
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(theme).toBe('dark');
    await selectThemeMode(page, '浅色');
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe('light');
    await selectThemeMode(page, '深色');
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe('dark');
  });

  test('color scheme cards remain available when following the system', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await gotoSetting(page, '主题');
    await selectThemeMode(page, '跟随系统');
    await expect(page.getByRole('radiogroup', { name: '深色配色' }).getByRole('radio')).toHaveCount(6);
    await expect(page.getByRole('radiogroup', { name: '浅色配色' })).toHaveCount(0);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByRole('radiogroup', { name: '深色配色' })).toHaveCount(0);
    await expect(page.getByRole('radiogroup', { name: '浅色配色' }).getByRole('radio')).toHaveCount(5);
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
  test('Each shell defaults to block mode; switching to classic mode persists', async ({ page }, testInfo) => {
    await gotoSetting(page, 'Zsh');
    const modes = page.getByRole('radiogroup', { name: '打开方式', exact: true });
    await expect(modes.getByRole('radio', { name: '块模式', exact: true })).toBeChecked();
    await modes.getByRole('radio', { name: '经典模式', exact: true }).click();
    const saved = await page.evaluate(() => localStorage.getItem('vrykell-agent-settings') ?? '');
    expect(saved).toContain('"zsh":"classic"');
    await modes.getByRole('radio', { name: '经典模式', exact: true }).press('ArrowRight');
    await expect(modes.getByRole('radio', { name: '块模式', exact: true })).toBeChecked();
    await gotoSetting(page, 'Bash');
    await gotoSetting(page, 'Zsh');
    await expect(modes.getByRole('radio', { name: '块模式', exact: true })).toBeChecked();
    for (const theme of ['深色', '浅色']) {
      await gotoSetting(page, '主题'); await selectThemeMode(page, theme);
      await gotoSetting(page, 'Zsh');
      for (const width of [760, 1240]) {
        await page.setViewportSize({ width, height: 800 });
        await expect(modes.getByRole('radio')).toHaveCount(2);
        expect(await modes.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
        await modes.screenshot({ path: testInfo.outputPath(`opening-mode-${theme}-${width}.png`) });
      }
    }
    await gotoSetting(page, 'CMD');
    await expect(modes.getByRole('radio')).toHaveCount(1);
    await expect(modes.getByRole('radio', { name: '经典模式', exact: true })).toBeChecked();
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
  test('Tool permission levels switch and persist', async ({ page }, testInfo) => {
    await gotoSetting(page, '工具权限');
    // Run terminal commands → deny
    const runRow = rowOf(page, '执行终端命令');
    const runPermissions = runRow.getByRole('radiogroup', { name: '执行终端命令 权限' });
    await runPermissions.getByRole('radio', { name: '禁止', exact: true }).click();
    await expect(runPermissions.getByRole('radio', { name: '禁止', exact: true })).toBeChecked();
    let saved = await page.evaluate(() => localStorage.getItem('vrykell-permissions') ?? '');
    expect(saved).toContain('"run_command":"deny"');
    // Web search → ask every time
    const webRow = rowOf(page, '联网搜索');
    const webPermissions = webRow.getByRole('radiogroup', { name: '联网搜索 权限' });
    await webPermissions.getByRole('radio', { name: '允许', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(webPermissions.getByRole('radio', { name: '每次询问', exact: true })).toBeChecked();
    saved = await page.evaluate(() => localStorage.getItem('vrykell-permissions') ?? '');
    expect(saved).toContain('"web_search":"ask"');
    await gotoSetting(page, '模型配置');
    await gotoSetting(page, '工具权限');
    await expect(runPermissions.getByRole('radio', { name: '禁止', exact: true })).toBeChecked();
    for (const width of [760, 1240]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(runPermissions.getByRole('radio')).toHaveCount(3);
      expect(await runRow.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      const first = (await runRow.boundingBox())!;
      const second = (await rowOf(page, '读取文件').boundingBox())!;
      if (width === 1240) expect(Math.abs(first.y - second.y)).toBeLessThanOrEqual(1);
      else expect(second.y).toBeGreaterThan(first.y);
      await page.locator('.settings-permission-list').screenshot({ path: testInfo.outputPath(`tool-permissions-${width}.png`) });
    }
  });

  test('Clear session grants button reports success', async ({ page }) => {
    await gotoSetting(page, '工具权限');
    await page.getByRole('button', { name: '清空会话授权' }).click();
    await expect(page.getByText('已清空全部会话授权')).toBeVisible();
  });
});
