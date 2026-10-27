import { expect, test, type Page } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

async function dragPanel(page: Page, id: string, side: 'left' | 'right') {
  const headingLocator = page.getByTestId(`panel-drag-handle-${id}`);
  // An open panel drags by its heading; a closed one drags from its dock button.
  const source = await headingLocator.isVisible() ? headingLocator : page.locator(`[data-dock-zone] [data-dock-btn="${id}"]`).first();
  const heading = (await source.boundingBox())!;
  const target = side === 'left' ? (await page.getByTestId('workspace-left-dock').boundingBox())! : (await page.locator('.workspace-body').boundingBox())!;
  await page.mouse.move(heading.x + 24, heading.y + heading.height / 2); await page.mouse.down();
  await page.mouse.move(side === 'left' ? 80 : target.x + target.width - 20, target.y + Math.min(180, target.height / 2), { steps: 8 });
  await expect(page.getByTestId('panel-drop-preview')).toHaveAttribute('data-side', side);
}

for (const theme of ['深色', '浅色']) test(`left and right panels retain their content independently in ${theme}`, async ({ page }, info) => {
  await setupTauriMock(page, {}); await page.goto('/');
  await gotoSetting(page, '主题'); await page.getByRole('radio', { name: theme, exact: true }).click();
  await page.keyboard.press('Escape');
  await page.locator('[data-dock-btn="chat"]').click();
  const composer = page.locator('[data-chat-composer]:visible');
  await composer.fill('Preserve across both sides');
  await composer.evaluate(element => { (window as unknown as { savedPanelComposer: Element }).savedPanelComposer = element; });
  await dragPanel(page, 'chat', 'left');
  await page.screenshot({ path: info.outputPath(`left-placement-${theme}.png`), animations: 'disabled' });
  await page.mouse.up();
  const left = page.locator('.workspace-side-panel[data-side="left"][data-visible="true"]');
  await expect(left.locator('[data-chat-composer]')).toHaveValue('Preserve across both sides');
  await expect(left.locator('.workspace-panel-heading')).toHaveCount(1);
  await page.locator('[data-dock-zone="right"] [data-dock-btn="files"]').click();
  const right = page.locator('.workspace-side-panel[data-side="right"][data-visible="true"]');
  await expect(right.getByText('notes.txt')).toBeVisible();
  await expect(left).toBeVisible();
  await page.screenshot({ path: info.outputPath(`independent-panels-${theme}.png`), animations: 'disabled' });
  await page.getByTestId('workspace-sidebar-toggle').click();
  await expect(left).toBeHidden(); await expect(right).toBeVisible();
  await page.getByTestId('workspace-sidebar-expand').click();
  await expect(left).toBeVisible(); await expect(composer).toHaveValue('Preserve across both sides');
  await left.locator('.workspace-panel-close').click();
  await expect(left).toHaveCount(0); await expect(right).toBeVisible();
  await dragPanel(page, 'chat', 'left'); await page.mouse.up();
  await expect(composer).toHaveValue('Preserve across both sides');
  expect(await composer.evaluate(element => element === (window as unknown as { savedPanelComposer: Element }).savedPanelComposer)).toBe(true);
  await dragPanel(page, 'chat', 'right'); await page.mouse.up();
  await expect(page.locator('.workspace-side-panel[data-side="left"][data-visible="true"]')).toHaveCount(0);
  await expect(page.locator('.workspace-side-panel[data-side="right"][data-visible="true"] [data-chat-composer]')).toHaveValue('Preserve across both sides');
  expect(await composer.evaluate(element => element === (window as unknown as { savedPanelComposer: Element }).savedPanelComposer)).toBe(true);
});

test('a collapsed left target expands on drop and both sides restore after reload', async ({ page }, info) => {
  await setupTauriMock(page, {}); await page.goto('/');
  await page.locator('[data-dock-btn="files"]').click();
  await page.getByTestId('workspace-sidebar-toggle').click();
  await dragPanel(page, 'files', 'left'); await page.mouse.up();
  const left = page.locator('.workspace-side-panel[data-side="left"][data-visible="true"]');
  await expect(page.getByTestId('workspace-sidebar')).toBeVisible();
  await expect(left.getByText('notes.txt')).toBeVisible();
  await page.locator('[data-dock-zone="right"] [data-dock-btn="chat"]').click();
  const right = page.locator('.workspace-side-panel[data-side="right"][data-visible="true"]');
  await expect(right.locator('[data-chat-composer]')).toBeVisible();
  await page.reload();
  await expect(left.getByText('notes.txt')).toBeVisible();
  await expect(right.locator('[data-chat-composer]')).toBeVisible();
  await page.setViewportSize({ width: 760, height: 800 });
  await expect(left).toBeHidden(); await expect(right).toBeVisible();
  await page.getByTestId('workspace-sidebar-expand').click();
  await expect(left.getByText('notes.txt')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(760);
  await page.screenshot({ path: info.outputPath('independent-panels-narrow.png'), animations: 'disabled' });
});
