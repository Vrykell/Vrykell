import { expect, test, type Locator, type Page } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

const rgb = async (_page: Page, locator: Locator) => locator.evaluate(element => getComputedStyle(element).backgroundColor);
const asRgb = (hex: string) => {
  const value = hex.trim().replace('#', '');
  return `rgb(${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)})`;
};

for (const theme of ['dark', 'light']) test(`workspace chrome and cards share the unified ${theme} surface`, async ({ page }, info) => {
  await setupTauriMock(page, { schedulesSeed: [] });
  await page.addInitScript(theme => localStorage.setItem('vrykell-theme-mode', theme), theme);
  await page.goto('/');
  const titlebar = page.locator('.workspace-titlebar');
  const colors = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return { chrome: style.getPropertyValue('--chrome-bg'), auxiliary: style.getPropertyValue('--auxiliary-bg'), card: style.getPropertyValue('--chrome-field') };
  });
  const chrome = asRgb(colors.chrome);
  const auxiliary = asRgb(colors.auxiliary);
  const card = asRgb(colors.card);
  expect(await rgb(page, titlebar)).toBe(chrome);
  expect(await rgb(page, page.locator('.workspace-main .terminal-composer').first())).toBe(card);

  await page.locator('[data-dock-zone="right"] [data-dock-btn="files"]').click();
  const rightSurface = page.locator('.workspace-side-panel[data-side="right"][data-visible="true"] > div').first();
  expect(await rgb(page, rightSurface)).toBe(auxiliary);
  expect(await rgb(page, page.locator('.workspace-instance-bar'))).toBe(auxiliary);
  const divider = page.locator('.workspace-side-panel[data-side="right"] [data-resize-line]').first();
  expect(await rgb(page, divider)).toBe('rgba(0, 0, 0, 0)');
  await page.getByTestId('resize-handle-files').hover();
  await expect.poll(async () => rgb(page, divider)).not.toBe('rgba(0, 0, 0, 0)');

  await page.evaluate(async () => {
    const { useDockStore } = await import('/src/features/workspace/stores/dock.ts');
    useDockStore.getState().moveButton('files', 'left');
    useDockStore.getState().openPanel('files');
  });
  const left = page.locator('.workspace-side-panel[data-side="left"][data-visible="true"]');
  await expect(left).toBeVisible();
  await expect(left.locator('.workspace-panel-heading')).toHaveCount(0);
  expect(await left.evaluate(element => getComputedStyle(element).borderTopWidth)).toBe('1px');
  await expect(page.getByText('工具栏', { exact: true })).toBeVisible();
  expect(await page.getByTestId('workspace-left-dock').evaluate(element => getComputedStyle(element).borderTopWidth)).toBe('0px');
  const leftTool = page.locator('.workspace-left-navigation [data-dock-btn="files"]');
  const leftRow = leftTool.locator('.sidebar-row-content');
  expect((await leftRow.boundingBox())!.width).toBeGreaterThan(120);
  const workspaceRow = page.getByTestId('workspace-area-terminal').locator('.sidebar-row-content');
  const settingsRow = page.getByTestId('workspace-settings').locator('.sidebar-row-content');
  expect((await leftRow.boundingBox())!.height).toBe((await workspaceRow.boundingBox())!.height);
  expect((await leftRow.boundingBox())!.height).toBe((await settingsRow.boundingBox())!.height);
  expect((await leftRow.boundingBox())!.x).toBeCloseTo((await workspaceRow.boundingBox())!.x, 0);
  expect((await leftRow.locator('.sidebar-row-title').boundingBox())!.x).toBeCloseTo((await workspaceRow.locator('.sidebar-row-title').boundingBox())!.x, 0);
  expect(await leftRow.locator('.sidebar-row-icon').evaluate(element => getComputedStyle(element).color)).toBe(await workspaceRow.locator('.sidebar-row-icon').evaluate(element => getComputedStyle(element).color));

  await page.getByTestId('workspace-settings').click();
  const settingsNav = page.locator('.settings-navigation');
  const settingsCard = page.locator('.settings-group-panel').first();
  expect(await rgb(page, settingsNav)).toBe(auxiliary);
  expect(await settingsNav.evaluate(element => getComputedStyle(element).borderRightWidth)).toBe('1px');
  expect(await rgb(page, page.locator('.settings-screen'))).toBe(auxiliary);
  expect(await rgb(page, page.locator('.settings-content'))).toBe(auxiliary);
  expect(await rgb(page, settingsCard)).toBe(card);
  expect(await settingsCard.evaluate(element => getComputedStyle(element).boxShadow)).toBe('none');
  expect(await settingsCard.evaluate(element => getComputedStyle(element).borderRadius)).toBe('8px');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();

  await page.getByTestId('workspace-history').click();
  const historyHeader = page.locator('.history-header');
  const historyCard = page.locator('.history-group-card').first();
  expect(await rgb(page, historyHeader)).toBe(auxiliary);
  expect(await rgb(page, page.getByTestId('unified-history-page').locator('.history-list'))).toBe(auxiliary);
  expect(await rgb(page, historyCard)).toBe(card);
  expect(await historyCard.evaluate(element => getComputedStyle(element).boxShadow)).toBe('none');
  expect(await historyCard.evaluate(element => getComputedStyle(element).borderRadius)).toBe('8px');
  expect((await historyHeader.boundingBox())!.height).toBe(34);

  await page.getByTestId('workspace-area-ai').click();
  await page.getByTestId('ai-new-conversation').click();
  const chatToolbar = page.locator('.chat-conversation-heading');
  expect(await rgb(page, chatToolbar)).toBe(auxiliary);
  expect((await chatToolbar.boundingBox())!.height).toBe(34);
  expect(await rgb(page, page.locator('.ai-chat-panel:visible .terminal-composer'))).toBe(card);

  await page.evaluate(async () => {
    const { useWorkspaceStore } = await import('/src/features/workspace/stores/workspace.ts');
    useWorkspaceStore.getState().openUsageTab();
  });
  const usageCard = page.locator('.usage-card').first();
  await expect(page.getByTestId('usage-page')).toBeVisible();
  expect(await rgb(page, usageCard)).toBe(card);
  expect(await usageCard.evaluate(element => getComputedStyle(element).boxShadow)).toBe('none');
  expect(await usageCard.evaluate(element => getComputedStyle(element).borderRadius)).toBe('8px');
  await page.screenshot({ path: info.outputPath(`unified-surfaces-${theme}.png`), animations: 'disabled' });
});
