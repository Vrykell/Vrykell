import { expect, test } from '@playwright/test';
import { setupTauriMock, ensureTabsOpen } from './tauri-mock';
import { gotoSetting } from './settings';

for (const theme of ['深色', '浅色']) {
  test(`tab icon colors persist and follow execution targets in ${theme}`, async ({ page }, testInfo) => {
    await setupTauriMock(page);
    await page.goto('/');
    await gotoSetting(page, '主题');
    await page.getByRole('radio', { name: theme, exact: true }).click();
    await ensureTabsOpen(page);
    const row = page.locator('[data-tab-kind="session"]').first();
    const id = (await row.getAttribute('data-tab-row-id'))!;
    await row.click();
    const original = await row.locator('.sidebar-row-icon svg').evaluate(element => getComputedStyle(element).color);
    await row.click({ button: 'right' });
    const menu = page.getByRole('menu', { name: '操作菜单' });
    const close = menu.getByRole('button', { name: '关闭标签', exact: true });
    const danger = await close.evaluate(element => getComputedStyle(element).color);
    expect(danger).not.toBe(await menu.getByRole('button', { name: '复制会话', exact: true }).evaluate(element => getComputedStyle(element).color));
    await expect(menu.getByRole('group', { name: '图标颜色' })).toBeVisible();
    await menu.getByRole('menuitemradio', { name: '紫色', exact: true }).click();
    const selected = await row.locator('.sidebar-row-icon svg').evaluate(element => getComputedStyle(element).color);
    expect(selected).not.toBe(original);
    await page.locator('[data-dock-btn="chat"]').click();
    await page.getByRole('button', { name: '会话设置', exact: true }).click();
    const environment = page.getByTestId('chat-execution-target');
    await environment.click();
    const target = page.getByRole('option').filter({ has: page.locator('.ui-select-swatch') }).last();
    await expect(target.locator('.ui-select-swatch')).toHaveCSS('background-color', selected);
    await target.click();
    await expect(environment.locator('.ui-select-swatch')).toHaveCSS('background-color', selected);
    await page.screenshot({ path: testInfo.outputPath('linked-tab-color.png'), animations: 'disabled' });
    await page.reload();
    await ensureTabsOpen(page);
    const restored = page.getByTestId(`tab-row-${id}`);
    await expect(restored.locator('.sidebar-row-icon svg')).toHaveCSS('color', selected);
    await restored.click({ button: 'right' });
    await page.getByTestId('tab-icon-color-auto').click();
    await expect(restored.locator('.sidebar-row-icon svg')).toHaveCSS('color', original);
    const settings = page.locator('[data-tab-kind="settings"]');
    await page.keyboard.press('Meta+,');
    await settings.click({ button: 'right' });
    await menu.getByRole('menuitemradio', { name: '蓝色', exact: true }).click();
    const icon = settings.locator('.sidebar-row-icon svg');
    await expect(icon).toHaveAttribute('style', /color: var\(--group-blue\)/);
    await expect(settings.locator('.sidebar-row-icon')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await page.getByTestId('tab-history-btn').click();
    await page.getByRole('button', { name: 'AI 对话历史', exact: true }).click();
    const marks = await page.locator('[data-tab-kind]:not([data-tab-kind="session"]) .sidebar-row-icon svg').evaluateAll(elements =>
      elements.map(element => [...element.querySelectorAll('path')].map(path => path.getAttribute('d')).join(' ')));
    expect(new Set(marks).size).toBe(3);
    await settings.click();
    await page.screenshot({ path: testInfo.outputPath('singleton-icons.png'), animations: 'disabled' });
  });

  test(`settings text, hover hints and collapsed navigation remain consistent in ${theme}`, async ({ page }, testInfo) => {
    await setupTauriMock(page);
    await page.goto('/');
    await gotoSetting(page, '主题');
    await page.getByRole('radio', { name: theme, exact: true }).click();
    await page.evaluate(() => document.documentElement.style.setProperty('--font-ui', 'Arial, sans-serif'));
    const navigation = page.locator('.settings-navigation');
    await navigation.getByRole('button', { name: '模型行为', exact: true }).click();
    const prompt = page.getByPlaceholder('留空使用内置默认提示词');
    await expect(prompt).toHaveCSS('font-family', 'Arial, sans-serif');
    expect(await prompt.evaluate(element => getComputedStyle(element, '::placeholder').fontFamily)).toBe('Arial, sans-serif');
    await page.mouse.move(0, 0);
    await navigation.getByRole('button', { name: '模型行为', exact: true }).hover();
    await expect(page.getByTestId('app-tooltip')).toHaveCSS('font-family', 'Arial, sans-serif');
    for (const name of ['模型配置', '网络搜索', 'MCP 服务器', '记忆', '子代理', '本地编辑器', '远程编辑器']) {
      await navigation.getByRole('button', { name, exact: true }).click();
      const wrong = await page.locator('.settings-content input:not([type="checkbox"]), .settings-content textarea').evaluateAll(elements => elements
        .filter(element => getComputedStyle(element).fontFamily !== 'Arial, sans-serif').map(element => element.getAttribute('placeholder')));
      expect(wrong).toEqual([]);
    }
    await page.setViewportSize({ width: 600, height: 760 });
    const content = page.locator('.settings-content');
    const before = (await content.boundingBox())!;
    const trigger = page.getByRole('button', { name: '展开设置目录', exact: true });
    await expect(navigation).toBeHidden();
    await trigger.click();
    await expect(navigation).toBeVisible();
    const after = (await content.boundingBox())!;
    expect(after.y).toBe(before.y);
    expect(after.height).toBe(before.height);
    expect(after.width).toBe(before.width);
    const bounds = (await navigation.boundingBox())!;
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(600);
    await page.keyboard.press('Escape');
    await expect(navigation).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await navigation.getByRole('button', { name: '模型配置', exact: true }).click();
    await expect(navigation).toBeHidden();
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
