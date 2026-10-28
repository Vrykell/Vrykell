import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

for (const theme of ['深色', '浅色']) {
  test(`search palette and colored shell marks fit the workspace in ${theme}`, async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await gotoSetting(page, '主题');
    await page.getByRole('radio', { name: theme, exact: true }).click();
    await page.keyboard.press('Meta+1');
    await page.getByTestId('tab-new-btn').click();
    const picker = page.getByRole('dialog', { name: '新建标签页' });
    const colors = await picker.locator('[data-shell-mark="zsh"], [data-shell-mark="bash"]').evaluateAll(elements =>
      elements.map(element => getComputedStyle(element).color));
    expect(colors).toHaveLength(2);
    await picker.screenshot({ path: test.info().outputPath('colored-shell-picker.png'), animations: 'disabled' });
    await picker.press('Escape');
    await page.getByTestId('global-search-trigger').click();
    const dialog = page.getByRole('dialog', { name: '全局搜索' });
    const input = dialog.getByRole('textbox', { name: '搜索工作区' });
    await expect(input).toBeFocused();
    const bodyColors = await dialog.locator('.global-search-body').evaluate(element => {
      const actual = getComputedStyle(element).backgroundColor;
      const probe = document.createElement('span');
      probe.style.background = 'transparent';
      element.appendChild(probe);
      const expected = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { actual, expected };
    });
    expect(bodyColors.actual).toBe(bodyColors.expected);
    await expect(dialog.getByText('6 个搜索来源')).toBeVisible();
    await expect(dialog.locator('.global-search-sources > button')).toHaveCount(6);
    // 指令字符卡片：无边框 + 灰色底
    const prefixBadge = dialog.locator('.global-search-sources kbd').first();
    await expect(prefixBadge).toHaveCSS('border-top-style', 'none');
    const badgeBackground = await prefixBadge.evaluate(element => {
      const actual = getComputedStyle(element).backgroundColor;
      const probe = document.createElement('span');
      probe.style.background = 'var(--hover)';
      element.appendChild(probe);
      const expected = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { actual, expected };
    });
    expect(badgeBackground.actual).toBe(badgeBackground.expected);
    await dialog.screenshot({ path: test.info().outputPath('search-empty.png'), animations: 'disabled' });
    await dialog.getByTestId('search-filter-button').click();
    const history = dialog.getByRole('menuitemcheckbox', { name: /历史命令/ });
    // 勾选框与 SSH 连接面板一致：主题化原生复选框，16px 尺寸
    const historyBox = history.locator('input.themed-checkbox');
    await expect(historyBox).toBeChecked();
    expect(await historyBox.evaluate(el => { const r = el.getBoundingClientRect(); return { width: r.width, height: r.height }; }))
      .toEqual({ width: 16, height: 16 });
    await history.click();
    await expect(history).toHaveAttribute('aria-checked', 'false');
    await expect(history.locator('input.themed-checkbox')).not.toBeChecked();
    await expect(dialog.getByRole('menuitemcheckbox', { name: /文件/ })).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.getByRole('menuitemcheckbox', { name: /文件/ }).locator('input.themed-checkbox')).toBeChecked();
    await expect(dialog.getByText('5 个搜索来源')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('search-scope.png'), animations: 'disabled' });
    await input.press('Escape');
    await expect(dialog.getByRole('menu')).toBeHidden();
    await expect(dialog).toBeVisible();
    await input.fill('npm');
    await expect(dialog.locator('[data-search-result]').first()).toBeVisible();
    await dialog.getByTestId('search-filter-button').press('Enter');
    await expect(dialog.getByRole('menu')).toBeVisible();
    await input.press('Escape');
    await page.screenshot({ path: test.info().outputPath('search-results.png'), animations: 'disabled' });
    await input.press('Escape');
    await expect(dialog).toBeHidden();
  });
}

test('search and its scope menu fit a narrow, short viewport', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await page.setViewportSize({ width: 360, height: 480 });
  await page.getByTestId('global-search-trigger').click();
  const dialog = page.getByRole('dialog', { name: '全局搜索' });
  await dialog.getByTestId('search-filter-button').click();
  const menu = dialog.getByRole('menu');
  await expect(menu).toBeInViewport();
  for (const element of [dialog, menu]) {
    const bounds = (await element.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(360);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(480);
  }
  await page.screenshot({ path: test.info().outputPath('search-narrow.png'), animations: 'disabled' });
});

test('prefixes scope results temporarily and settings search focuses individual controls', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await page.getByTestId('global-search-trigger').click();
  const dialog = page.getByRole('dialog', { name: '全局搜索' });
  const input = dialog.getByRole('textbox', { name: '搜索工作区' });
  await input.fill('@ 终端字号');
  const result = dialog.locator('[data-search-result]').filter({ hasText: '终端字号' }).first();
  await expect(result).toBeVisible();
  expect(await dialog.locator('[data-search-result]').count()).toBe(1);
  expect(await result.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await result.click();
  await expect(page.getByRole('combobox', { name: '终端字号', exact: true })).toBeFocused();
  await page.getByTestId('global-search-trigger').click();
  await input.fill('@ 补全防抖');
  await dialog.locator('[data-search-result]').filter({ hasText: '补全防抖' }).click();
  await expect(page.locator('.settings-field[data-setting-title="补全防抖"]')).toHaveAttribute('data-setting-title', '补全防抖');
  await page.getByTestId('global-search-trigger').click();
  await input.fill('>');
  await expect(dialog.locator('[data-search-result]').first()).toBeVisible();
  await dialog.getByRole('button', { name: '清除搜索范围' }).click();
  await input.fill('@');
  await expect.poll(() => dialog.locator('[data-search-result]').count()).toBeGreaterThan(30);
  await dialog.getByRole('button', { name: '清除搜索范围' }).click();
  await input.fill('/ config');
  await expect(dialog.getByTestId('search-scope-chip')).toContainText('文件');
  await expect(dialog.locator('[data-search-result]').first()).toBeVisible();
  for (const theme of ['dark', 'light'] as const) {
    await page.evaluate(async theme => { const { applyTheme } = await import('/src/config/theme/tokens.ts'); applyTheme(theme); }, theme);
    await dialog.screenshot({ path: test.info().outputPath(`shared-filter-chip-${theme}.png`), animations: 'disabled' });
  }
  await input.press('Escape');
  await page.getByTestId('global-search-trigger').click();
  const history = dialog.locator('.global-search-history').first();
  await expect(history).toBeVisible();
  expect(await history.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
});
