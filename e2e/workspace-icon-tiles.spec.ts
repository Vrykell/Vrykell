import { expect, test } from '@playwright/test';
import { setupTauriMock, ensureTabsOpen } from './tauri-mock';
import { gotoSetting } from './settings';

for (const theme of ['深色', '浅色']) {
  test(`only terminal tabs expose icon colors while group actions remain available in ${theme}`, async ({ page }, testInfo) => {
    await setupTauriMock(page);
    await page.addInitScript(() => localStorage.setItem('vrykell-icon-colors', JSON.stringify({ state: {
      colors: { 'page:settings': 'coral', 'group:team': 'violet' },
    }, version: 0 })));
    await page.goto('/');
    await gotoSetting(page, '主题');
    await page.getByRole('radio', { name: theme, exact: true }).click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await ensureTabsOpen(page);
    await page.getByTestId('tab-history-btn').click();
    const settings = page.locator('[data-tab-kind="history"]');
    await settings.click({ button: 'right' });
    await expect(page.getByRole('menuitemradio')).toHaveCount(0);
    await expect(settings.locator('[role="tab"] svg')).toHaveAttribute('style', /color: var\(--text-primary\)/);
    await page.keyboard.press('Escape');
    const member = page.locator('[data-tab-kind="session"]').first();
    const original = await member.locator('[role="tab"] svg').evaluate(element => getComputedStyle(element).color);
    await member.click({ button: 'right' });
    await page.getByRole('button', { name: '新建分组', exact: true }).click();
    const header = page.locator('[data-group-header-id]').first();
    await header.getByRole('textbox').press('Enter');
    await header.click({ button: 'right' });
    const menu = page.getByRole('menu', { name: '分组操作' });
    await expect(menu.getByRole('button', { name: '归档分组', exact: true })).toBeVisible();
    await expect(menu.getByRole('menuitemradio')).toHaveCount(9);
    await page.keyboard.press('Escape');
    await expect(header).toBeFocused();
    await header.press('Enter');
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await header.press('Enter');
    await member.click({ button: 'right' });
    const violet = await member.evaluate(element => {
      const probe = document.createElement('span'); element.append(probe);
      probe.style.color = 'var(--cmd-pipe)';
      const color = getComputedStyle(probe).color; probe.remove(); return color;
    });
    await expect(page.getByRole('menuitemradio', { name: '紫色', exact: true })).toHaveCSS('background-color', violet);
    await page.getByRole('menuitemradio', { name: '紫色', exact: true }).click();
    await expect(member.locator('[role="tab"] svg')).toHaveCSS('color', violet);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('vrykell-icon-colors')!).state.colors['page:settings'])).toBeUndefined();
    await page.screenshot({ path: testInfo.outputPath('terminal-only-icon-colors.png'), animations: 'disabled' });
    await member.click({ button: 'right' });
    await page.getByTestId('tab-icon-color-auto').click();
    await expect(member.locator('[role="tab"] svg')).toHaveCSS('color', original);
  });
}
