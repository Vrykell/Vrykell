import { expect, test } from '@playwright/test';
import { setupTauriMock, ensureTabsOpen } from './tauri-mock';
import { gotoSetting } from './settings';

for (const theme of ['深色', '浅色']) {
  test(`shell icons retain their identity and action menus stay compact in ${theme}`, async ({ page }, testInfo) => {
    await setupTauriMock(page);
    await page.goto('/');
    await gotoSetting(page, '主题');
    await page.getByRole('radio', { name: `始终${theme}`, exact: true }).click();
    await ensureTabsOpen(page);
    const row = page.locator('[data-tab-kind="session"]').first();
    const id = (await row.getAttribute('data-tab-row-id'))!;
    await row.click();
    const original = await row.locator('[data-shell-mark]').getAttribute('data-shell-mark');
    await row.click({ button: 'right' });
    const menu = page.getByRole('menu', { name: '标签页操作' });
    const close = menu.getByRole('button', { name: '关闭标签', exact: true });
    const danger = await close.evaluate(element => getComputedStyle(element).color);
    expect(danger).not.toBe(await menu.getByRole('button', { name: '复制会话', exact: true }).evaluate(element => getComputedStyle(element).color));
    await expect(menu.getByRole('group', { name: '图标颜色' })).toHaveCount(0);
    await expect(menu.getByRole('menuitem', { name: '图标颜色', exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('tab-color-footer.png') });
    await page.keyboard.press('Escape');
    await page.reload();
    await ensureTabsOpen(page);
    const restored = page.getByTestId(`tab-row-${id}`);
    await expect(restored.locator('[data-shell-mark]')).toHaveAttribute('data-shell-mark', original!);
    await page.getByTestId('tab-history-btn').click();
    await expect(page.locator('[data-testid="unified-history-page"]:visible')).toBeVisible();
    await expect(page.locator('[data-tab-kind="history"], [data-tab-kind="ai-history"]')).toHaveCount(1);
  });

  test(`settings text, hover hints and permanent navigation remain consistent in ${theme}`, async ({ page }, testInfo) => {
    await setupTauriMock(page);
    await page.goto('/');
    await gotoSetting(page, '主题');
    await page.getByRole('radio', { name: `始终${theme}`, exact: true }).click();
    await page.evaluate(() => document.documentElement.style.setProperty('--font-ui', 'Arial, sans-serif'));
    const navigation = page.locator('.settings-navigation');
    await navigation.getByRole('button', { name: '模型行为', exact: true }).click();
    const prompt = page.getByPlaceholder('留空使用内置默认提示词');
    await expect(prompt).toHaveCSS('font-family', 'Arial, sans-serif');
    expect(await prompt.evaluate(element => getComputedStyle(element, '::placeholder').fontFamily)).toBe('Arial, sans-serif');
    await page.mouse.move(0, 0);
    await navigation.getByRole('button', { name: '模型行为', exact: true }).hover();
    await expect(page.getByTestId('app-tooltip')).toHaveCSS('font-family', 'Arial, sans-serif');
    for (const name of ['模型配置', '联网搜索', 'MCP 服务器', '记忆', '本地文件打开方式', '远程文件打开方式']) {
      await navigation.getByRole('button', { name, exact: true }).click();
      const wrong = await page.locator('.settings-content input:not([type="checkbox"]), .settings-content textarea').evaluateAll(elements => elements
        // A URL field is deliberately monospace; the rule is about UI text.
        .filter(element => {
          const family = getComputedStyle(element).fontFamily;
          return family !== 'Arial, sans-serif' && !/mono/i.test(family);
        })
        .map(element => element.getAttribute('placeholder')));
      expect(wrong).toEqual([]);
    }
    // The API address keeps its monospace face on purpose.
    await navigation.getByRole('button', { name: '模型配置', exact: true }).click();
    await expect(page.getByTestId('provider-endpoint-input')).toHaveCSS('font-family', /mono/i);
    await page.setViewportSize({ width: 600, height: 760 });
    const content = page.locator('.settings-content');
    await expect(navigation).toBeVisible();
    await expect(page.locator('.settings-navigation-toggle')).toHaveCount(0);
    await navigation.getByRole('button', { name: '模型配置', exact: true }).click();
    await expect(navigation).toBeVisible();
    await content.evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: testInfo.outputPath('collapsed-settings-navigation.png'), animations: 'disabled' });
    await page.getByTestId('global-search-trigger').click();
    const palette = page.locator('.global-search-dialog');
    await expect(palette).toBeVisible();
    await expect(palette.locator('.global-search-body')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(palette.locator('.global-search-query')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(palette.getByRole('textbox')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await page.screenshot({ path: testInfo.outputPath('unified-global-search.png'), animations: 'disabled' });
  });
}
