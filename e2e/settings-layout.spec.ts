import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { gotoSetting, fieldOf } from './settings';

for (const theme of ['深色', '浅色']) {
  test(`grouped settings align controls and adapt to narrow columns in ${theme}`, async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await gotoSetting(page, '主题');
    await page.getByRole('radio', { name: theme, exact: true }).click();
    const group = page.getByRole('group', { name: '字体与显示' });
    await expect(group.getByRole('combobox')).toHaveCount(6);
    const row = fieldOf(page, '页面字号');
    const label = row.getByText('页面字号', { exact: true });
    const control = row.getByRole('combobox', { name: '页面字号' });
    const a = (await label.boundingBox())!;
    const b = (await control.boundingBox())!;
    expect(b.x).toBeGreaterThan(a.x + a.width);
    expect(b.y).toBeLessThan(a.y + 40);
    await expect(row.locator('xpath=following-sibling::*[1]')).toHaveCSS('border-top-width', '1px');
    await page.mouse.move(0, 0);
    await page.screenshot({ path: test.info().outputPath('grouped-theme.png'), animations: 'disabled' });
    await control.click();
    await page.getByRole('option', { name: '15px', exact: true }).click();
    await expect(control).toHaveText('15px');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('vrykell-typography')!).state.uiFontSize)).toBe(15);
    await page.setViewportSize({ width: 720, height: 720 });
    await control.scrollIntoViewIfNeeded();
    const narrowLabel = (await label.boundingBox())!;
    const narrowControl = (await control.boundingBox())!;
    expect(narrowControl.y).toBeGreaterThan(narrowLabel.y + narrowLabel.height);
    await expect.poll(() => page.locator('.settings-content').evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: test.info().outputPath('grouped-theme-narrow.png'), animations: 'disabled' });
    await page.setViewportSize({ width: 1240, height: 800 });
    await page.locator('aside').getByRole('button', { name: '模型行为', exact: true }).click();
    const prompt = fieldOf(page, '系统提示词');
    const promptBounds = (await prompt.boundingBox())!;
    const textBounds = (await prompt.getByRole('textbox').boundingBox())!;
    expect(textBounds.width).toBeGreaterThan(promptBounds.width * 0.85);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: test.info().outputPath('grouped-behavior.png'), animations: 'disabled' });
  });
}
