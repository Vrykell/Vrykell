import { expect, test, type Locator, type Page } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

const rgb = async (_page: Page, locator: Locator) => locator.evaluate(element => getComputedStyle(element).backgroundColor);
const asRgb = (hex: string) => {
  const value = hex.trim().replace('#', '');
  return `rgb(${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)})`;
};

for (const theme of ['dark', 'light']) test(`workspace chrome and cards share the unified ${theme} surface`, async ({ page }, info) => {
  await setupTauriMock(page, {});
  await page.addInitScript(theme => localStorage.setItem('vrykell-theme-mode', theme), theme);
  await page.goto('/');
  const titlebar = page.locator('.workspace-titlebar');
  const colors = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return { chrome: style.getPropertyValue('--chrome-bg'), auxiliary: style.getPropertyValue('--auxiliary-bg'), canvas: style.getPropertyValue('--canvas'), card: style.getPropertyValue('--card-bg'), composer: style.getPropertyValue('--composer-bg') };
  });
  const chrome = asRgb(colors.chrome);
  const auxiliary = asRgb(colors.auxiliary);
  const canvas = asRgb(colors.canvas);
  const card = asRgb(colors.card);
  const composer = asRgb(colors.composer);
  expect(await rgb(page, titlebar)).toBe(chrome);
  expect(await rgb(page, page.locator('.workspace-main .terminal-composer').first())).toBe(composer);

  await page.locator('[data-dock-zone="right"] [data-dock-btn="files"]').click();
  const rightSurface = page.locator('.workspace-side-panel[data-side="right"][data-visible="true"] > div').first();
  expect(await rgb(page, rightSurface)).toBe(auxiliary);
  expect(await rgb(page, page.locator('.workspace-instance-bar'))).toBe(auxiliary);
  const divider = page.locator('.workspace-side-panel[data-side="right"] [data-resize-line]').first();
  expect(await rgb(page, divider)).not.toBe('rgba(0, 0, 0, 0)');

  await page.evaluate(async () => {
    const { useDockStore } = await import('/src/features/workspace/stores/dock.ts');
    useDockStore.getState().moveButton('files', 'left');
    useDockStore.getState().openPanel('files');
  });
  const left = page.locator('.workspace-side-panel[data-side="left"][data-visible="true"]');
  await expect(left).toBeVisible();
  // The left dock keeps one panel with its own heading (label + close button) and no button row.
  await expect(left.locator('.workspace-panel-heading')).toHaveCount(1);
  await expect(left.locator('.workspace-panel-heading').getByRole('button', { name: /关闭|Close/ })).toBeVisible();
  await expect(page.locator('[data-dock-zone="left"] [data-dock-btn]')).toHaveCount(0);
  expect(await left.evaluate(element => getComputedStyle(element).borderTopWidth)).toBe('0px');
  expect(await page.getByTestId('workspace-left-dock').evaluate(element => getComputedStyle(element).borderTopWidth)).toBe('0px');
  // Workspace and settings rows keep the shared geometry after the dock rows were removed.
  const workspaceRow = page.getByTestId('workspace-area-terminal').locator('.sidebar-row-content');
  const settingsRow = page.getByTestId('workspace-settings').locator('.sidebar-row-content');
  expect((await workspaceRow.boundingBox())!.width).toBeGreaterThan(120);
  expect((await workspaceRow.boundingBox())!.height).toBe((await settingsRow.boundingBox())!.height);

  await page.getByTestId('workspace-settings').click();
  const settingsNav = page.locator('.settings-navigation');
  const settingsCard = page.locator('.settings-group-panel').first();
  expect(await rgb(page, settingsNav)).toBe(auxiliary);
  expect(await settingsNav.evaluate(element => getComputedStyle(element).borderRightWidth)).toBe('1px');
  expect(await rgb(page, page.locator('.settings-screen'))).toBe(auxiliary);
  expect(await rgb(page, page.locator('.settings-content'))).toBe(canvas);
  expect(await rgb(page, settingsCard)).toBe(card);
  expect(await settingsCard.evaluate(element => getComputedStyle(element).boxShadow)).toBe('none');
  expect(await settingsCard.evaluate(element => getComputedStyle(element).borderRadius)).toBe('8px');
  await page.keyboard.press('Escape');

  await page.getByTestId('workspace-history').click();
  const historyHeader = page.locator('.history-header');
  const historyCard = page.locator('.history-group-card').first();
  expect(await rgb(page, historyHeader)).toBe(canvas);
  expect(await rgb(page, page.getByTestId('unified-history-page').locator('.history-list'))).toBe(canvas);
  expect(await rgb(page, historyCard)).toBe(card);
  expect(await historyCard.evaluate(element => getComputedStyle(element).boxShadow)).toBe('none');
  expect(await historyCard.evaluate(element => getComputedStyle(element).borderRadius)).toBe('8px');
  expect((await historyHeader.boundingBox())!.height).toBe(34);

  await page.getByTestId('workspace-area-ai').click();
  await page.getByTestId('ai-new-conversation').click();
  expect(await rgb(page, page.locator('.ai-chat-panel:visible .terminal-composer'))).toBe(composer);

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
