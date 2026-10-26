import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { pickPlacementZone } from './placement';

for (const split of [false, true]) for (const theme of ['dark', 'light']) {
  test(`sidebar retains its own conversation beside ${split ? 'split' : 'single'} main content in ${theme}`, async ({ page }, info) => {
    await setupTauriMock(page, { schedulesSeed: [] });
    await page.addInitScript(theme => localStorage.setItem('vrykell-theme-mode', theme), theme);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.getByTestId('workspace-area-ai').click();
    await page.getByTestId('ai-new-conversation').click();
    if (split) {
      await page.getByTestId('workspace-instance-bar').getByRole('button', { name: '拆分标签页', exact: true }).click();
      await page.getByRole('menuitem', { name: '新对话', exact: true }).click();
      await pickPlacementZone(page, page.getByTestId('pane-workspace-ai').locator('.unified-pane').first(), 'right');
    }
    const main = page.getByTestId('ai-surface-main').locator('[data-chat-composer]:visible');
    await expect(main).toHaveCount(split ? 2 : 1);
    for (let index = 0; index < await main.count(); index++) await main.nth(index).fill(`Main draft ${index + 1}`);
    if (theme === 'light') await page.setViewportSize({ width: 900, height: 900 });
    await main.evaluateAll(elements => { (window as unknown as { mainNodes: Element[] }).mainNodes = elements; });
    await page.locator('[data-dock-btn="chat"]').click();
    const side = page.getByTestId('ai-surface-side').locator('[data-chat-composer]:visible');
    await expect(side).toHaveValue('');
    await side.fill('Independent side draft');
    for (let index = 0; index < await main.count(); index++) await expect(main.nth(index)).toHaveValue(`Main draft ${index + 1}`);
    expect(await main.evaluateAll(elements => elements.every((element, index) => element === (window as unknown as { mainNodes: Element[] }).mainNodes[index]))).toBe(true);
    await page.locator('[data-dock-btn="chat"]').click();
    await expect(side).toHaveCount(0);
    await page.locator('[data-dock-btn="chat"]').click();
    await expect(side).toHaveValue('Independent side draft');
    await expect(main).toHaveCount(split ? 2 : 1);
    await page.screenshot({ path: info.outputPath('independent-conversations.png') });
    if (split) {
      await page.getByTestId('ai-relocate').click();
      await expect(side).toHaveValue(/Main draft/);
    }
  });
}

test('opening the main agent workspace does not claim the sidebar agent', async ({ page }) => {
  await setupTauriMock(page, { schedulesSeed: [] }); await page.goto('/');
  await page.getByTestId('workspace-area-ai').click();
  await page.getByTestId('harness-add-session').click(); await page.getByTestId('acp-launcher-Fake ACP').click();
  const main = page.getByTestId('ai-surface-main').locator('[data-testid="harness-composer"]:visible');
  await main.fill('Main agent draft');
  await page.locator('[data-dock-btn="chat"]').click();
  const side = page.getByTestId('ai-surface-side');
  await side.getByRole('button', { name: '会话设置', exact: true }).click();
  await page.getByRole('button', { name: '选择智能体', exact: true }).click();
  await page.getByTestId('acp-launcher-Fake ACP').click(); await page.keyboard.press('Escape');
  await side.getByTestId('harness-composer').fill('Side agent draft');
  await page.getByTestId('workspace-area-terminal').click(); await page.getByTestId('workspace-area-ai').click();
  await expect(main).toHaveValue('Main agent draft');
  await expect(side.getByTestId('harness-composer')).toHaveValue('Side agent draft');
  await page.getByTestId('ai-return-to-workspace').click();
  await expect(main).toHaveValue('Side agent draft');
  await expect(side).toBeHidden();
});
