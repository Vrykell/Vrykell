import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

for (const theme of ['深色', '浅色']) test(`workspace colors and model controls remain consistent in ${theme}`, async ({ page }, info) => {
  await setupTauriMock(page, { schedulesSeed: [] }); await page.goto('/');
  await gotoSetting(page, '主题'); await page.getByRole('radio', { name: theme, exact: true }).click();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  const selected = page.getByTestId('workspace-area-terminal').locator('.sidebar-row-icon svg');
  const color = await selected.evaluate(element => getComputedStyle(element).color);
  const expectedIconColor = await page.evaluate(() => {
    const element = document.createElement('span'); element.style.color = 'var(--group-blue)'; document.body.append(element);
    const color = getComputedStyle(element).color; element.remove(); return color;
  });
  await expect(selected).toHaveCSS('color', expectedIconColor);
  expect(color).not.toBe(await page.getByTestId('workspace-area-code').locator('.sidebar-row-icon svg').evaluate(element => getComputedStyle(element).color));
  const [red, , blue] = color.match(/\d+/g)!.map(Number);
  expect(blue).toBeGreaterThan(red!);
  await page.locator('[data-dock-btn="chat"]').click();
  const panel = page.locator('.workspace-side-panel[data-visible="true"]');
  await expect(panel.locator('.workspace-panel-heading > span')).toHaveText('AI 助手');
  expect(await panel.locator(':scope > div').first().evaluate(element => getComputedStyle(element).backgroundColor))
    .toBe(await page.locator('.workspace-titlebar').evaluate(element => getComputedStyle(element).backgroundColor));
  expect(await page.locator('.workspace-main').evaluate(element => getComputedStyle(element).backgroundColor))
    .toBe(await page.locator('.workspace-titlebar').evaluate(element => getComputedStyle(element).backgroundColor));
  await page.screenshot({ path: info.outputPath(`workspace-colors-${theme}.png`), animations: 'disabled' });
  await page.getByTestId('workspace-sidebar-toggle').click();
  for (const width of [1240, 760]) {
    await page.setViewportSize({ width, height: 800 });
    const header = (await page.locator('.workspace-titlebar').boundingBox())!;
    const expand = page.getByTestId('workspace-sidebar-expand');
    const bounds = (await expand.boundingBox())!;
    expect(Math.abs(bounds.x - header.x - (bounds.y - header.y))).toBeLessThan(1);
    await expand.hover();
    await expect(expand).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await page.screenshot({ path: info.outputPath(`collapsed-${theme}-${width}.png`), animations: 'disabled' });
  }
  await page.setViewportSize({ width: 1240, height: 800 });
  await gotoSetting(page, '模型配置');
  await expect(page.getByTestId('workspace-settings').locator('.sidebar-row-icon svg')).toHaveCSS('color', expectedIconColor);
  const actions = ['model-settings', 'model-remove', 'model-add', 'model-sync'];
  for (const id of actions) {
    const button = page.getByTestId(id).first();
    await expect(button).toBeVisible();
    expect((await button.boundingBox())!.width).toBeGreaterThanOrEqual(32);
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(32);
  }
  await page.getByTestId('model-sync').click();
  await expect(page.getByTestId('model-sync')).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByTestId('model-sync').locator('svg')).toHaveClass(/reload-spin/);
  await expect(page.getByTestId('model-sync')).toHaveAttribute('aria-busy', 'false');
  await page.screenshot({ path: info.outputPath(`model-controls-${theme}.png`), animations: 'disabled' });
});

for (const platform of ['macos', 'linux']) test.describe(`${platform} settings and materials`, () => {
  test.use({ userAgent: platform === 'macos' ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15' : 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36' });
  test('omits unsupported system integration and retains a usable material treatment', async ({ page }, info) => {
    await setupTauriMock(page, { schedulesSeed: [] }); await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-native-material', platform === 'macos' ? 'active' : 'fallback');
    await gotoSetting(page, '主题');
    await expect(page.locator('.settings-navigation').getByRole('button', { name: 'Windows 右键菜单', exact: true })).toHaveCount(0);
    const settings = await page.evaluate(async () => {
      const path = '/src/features/settings/services/registry.ts';
      const { getSettings } = await import(path) as typeof import('../src/features/settings/services/registry');
      return getSettings().filter(setting => setting.page === 'context-menu').length;
    });
    expect(settings).toBe(0);
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    await expect(page.getByTestId('workspace-sidebar')).toBeVisible();
    await page.screenshot({ path: info.outputPath(`${platform}-material.png`), animations: 'disabled' });
  });
});
