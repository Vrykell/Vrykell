import { expect, test } from '@playwright/test';
import { ensureTabsOpen, setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

for (const theme of ['dark', 'light'] as const) {
  test(`settings and history have clean edges and bottom color choices in ${theme}`, async ({ page }, testInfo) => {
    await setupTauriMock(page, { groupedHistoricalSession: true, schedulesSeed: [] });
    await page.addInitScript(() => {
      const now = Date.now();
      localStorage.setItem('e2e-conversations', JSON.stringify([
        { id: 'surface-chat', title: 'Project planning', created_at: now, updated_at: now, environment: 'null' },
      ]));
    });
    await page.goto('/');
    await gotoSetting(page, '主题');
    await page.getByRole('radio', { name: theme === 'dark' ? '深色' : '浅色', exact: true }).click();
    await page.locator('aside').getByRole('button', { name: '字体与显示', exact: true }).click();
    const settingsCard = page.locator('.settings-group-panel').first();
    await expect(settingsCard).toHaveCSS('border-top-width', '0px');
    expect(await settingsCard.evaluate(element => getComputedStyle(element).boxShadow)).toBe('none');
    const font = page.getByRole('combobox', { name: '页面字号' });
    await expect(font).toHaveCSS('border-top-width', '0px');
    await font.click();
    const listbox = page.getByRole('listbox', { name: '页面字号' });
    await expect(listbox).toHaveCSS('border-top-width', '0px');
    const surface = page.locator('.ui-select-menu');
    await expect(surface).toHaveCSS('border-top-width', '0px');
    expect(await surface.evaluate(element => getComputedStyle(element).boxShadow)).not.toContain('inset');
    expect(await surface.evaluate(element => {
      const panel = document.querySelector('.settings-group-panel')!;
      // The floating surface carries the background; the listbox inside only scrolls.
      const surface = element.closest('.ui-select-menu') ?? element;
      const probe = document.createElement('span'); probe.style.backgroundColor = 'var(--menu-bg)'; panel.append(probe); const expected = getComputedStyle(probe).backgroundColor; probe.remove(); return getComputedStyle(surface).backgroundColor === expected;
    })).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`settings-clean-edges-${theme}.png`), animations: 'disabled' });
    await page.keyboard.press('Escape');

    await ensureTabsOpen(page);
    await page.getByTestId('tab-history-btn').click();
    const card = page.getByTestId('history-group-card-source:archived-group');
    await expect(card).toHaveCSS('border-top-width', '0px');
    expect(await card.evaluate(element => getComputedStyle(element).boxShadow)).toBe('none');
    expect(await card.evaluate(element => getComputedStyle(element).boxShadow)).not.toContain('inset');
    const trigger = card.getByRole('button', { name: '分组操作' });
    await trigger.click();
    const menu = page.getByRole('menu', { name: '分组操作' });
    await expect(menu).toHaveCSS('border-top-width', '0px');
    await expect(menu.getByRole('menuitemradio')).toHaveCount(9);
    const footer = (await menu.locator('.context-menu-footer').boundingBox())!;
    const lastAction = (await menu.getByRole('menuitem').last().boundingBox())!;
    expect(footer.y).toBeGreaterThanOrEqual(lastAction.y + lastAction.height);
    await menu.getByRole('menuitemradio', { name: '绿色', exact: true }).click();
    await expect(card).toHaveAttribute('data-group-color', 'green');
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(menu.getByRole('menuitemradio', { name: '绿色', exact: true })).toHaveAttribute('aria-checked', 'true');
    await page.screenshot({ path: testInfo.outputPath(`history-menu-clean-edges-${theme}.png`), animations: 'disabled' });
    await menu.getByRole('menuitemradio', { name: '自动配色', exact: true }).click();

    if (!await page.locator('[data-chat-composer]').isVisible()) await page.locator('[data-dock-btn="chat"]').click();
    await page.getByRole('button', { name: 'AI 对话历史', exact: true }).click();
    const aiCard = page.getByTestId('unified-history-page').locator('.history-group-card').first();
    await expect(aiCard).toHaveCSS('border-top-width', '0px');
    expect(await aiCard.evaluate(element => getComputedStyle(element).boxShadow)).toBe('none');
    await aiCard.getByRole('button', { name: '分组操作' }).click();
    await expect(menu.getByRole('menuitemradio')).toHaveCount(9);
    await menu.getByRole('menuitemradio', { name: '紫色', exact: true }).click();
    await expect(aiCard).toHaveAttribute('data-group-color', 'violet');
    await page.screenshot({ path: testInfo.outputPath(`ai-history-clean-edges-${theme}.png`), animations: 'disabled' });
  });
}
