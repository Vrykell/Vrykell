import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { gotoSetting, fieldOf } from './settings';

for (const theme of ['深色', '浅色']) {
  test(`grouped settings align controls and adapt to narrow columns in ${theme}`, async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await gotoSetting(page, '主题');
    await page.getByRole('radio', { name: `始终${theme}`, exact: true }).click();
    await page.locator('aside').getByRole('button', { name: '字体与显示', exact: true }).click();
    const group = page.getByRole('group', { name: '终端字体' });
    await expect(group.getByRole('combobox')).toHaveCount(5);
    const row = fieldOf(page, '页面字号');
    const label = row.getByText('页面字号', { exact: true });
    const control = row.getByRole('combobox', { name: '页面字号' });
    const a = (await label.boundingBox())!;
    const b = (await control.boundingBox())!;
    expect(b.x).toBeGreaterThan(a.x + a.width);
    expect(b.y).toBeLessThan(a.y + 40);
    await expect(row).toHaveCSS('border-top-width', '1px');
    expect((await row.boundingBox())!.height).toBeLessThanOrEqual(70);
    // The row keeps the card inset so its rule stops short of the card edge.
    const panel = page.locator('.settings-group-panel').first();
    await expect(panel).toHaveCSS('border-top-width', '1px');
    const panelBox = (await panel.boundingBox())!;
    const rowBox = (await row.boundingBox())!;
    const panelContent = await panel.evaluate((element) => {
      const style = getComputedStyle(element);
      return element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    });
    expect(Math.abs(rowBox.width - panelContent)).toBeLessThanOrEqual(2);
    expect(rowBox.x).toBeGreaterThan(panelBox.x);
    expect(rowBox.x + rowBox.width).toBeLessThan(panelBox.x + panelBox.width);
    // Short single-line controls stay near the 180px row-control width.
    expect(b.width).toBeLessThanOrEqual(181);
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
    await expect.poll(() => page.locator('.settings-content').evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: test.info().outputPath('grouped-theme-narrow.png'), animations: 'disabled' });
    await page.setViewportSize({ width: 1240, height: 800 });
    await page.locator('aside').getByRole('button', { name: '模型行为', exact: true }).click();
    const prompt = fieldOf(page, '系统提示词');
    const promptBounds = (await prompt.boundingBox())!;
    const textBounds = (await prompt.getByRole('textbox').boundingBox())!;
    expect(textBounds.width).toBeGreaterThan(promptBounds.width * 0.85);
    // Stacked single-line controls stay capped while the prompt keeps the full card width.
    const scopeControl = fieldOf(page, '配置作用域').getByRole('combobox', { name: '配置作用域' });
    expect((await scopeControl.boundingBox())!.width).toBeLessThanOrEqual(321);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: test.info().outputPath('grouped-behavior.png'), animations: 'disabled' });
    const agent = fieldOf(page, 'Agent 模式');
    await agent.scrollIntoViewIfNeeded();
    await expect(agent.getByText('已开启', { exact: true })).toHaveCount(0);
    await expect(agent.getByText('已关闭', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('grouped-toggles.png'), animations: 'disabled' });
    await gotoSetting(page, '语言');
    await page.screenshot({ path: test.info().outputPath('grouped-language.png'), animations: 'disabled' });
  });
}

test('ACP and MCP record rows span their settings card', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await gotoSetting(page, 'ACP');
  const acpCard = page.locator('.settings-group-panel').first();
  const acpRow = page.getByTestId('harness-row-0');
  await expect(acpRow).toBeVisible();
  const acpCardBox = (await acpCard.boundingBox())!;
  const acpRowBox = (await acpRow.boundingBox())!;
  expect(Math.abs(acpRowBox.width - acpCardBox.width)).toBeLessThanOrEqual(2);
  await gotoSetting(page, 'MCP 服务器');
  const mcpCard = page.locator('.settings-group-panel').first();
  const mcpRecord = mcpCard.locator('.settings-record').first();
  await expect(mcpRecord).toBeVisible();
  const mcpCardBox = (await mcpCard.boundingBox())!;
  const mcpRecordBox = (await mcpRecord.boundingBox())!;
  expect(Math.abs(mcpRecordBox.width - mcpCardBox.width)).toBeLessThanOrEqual(2);
});
