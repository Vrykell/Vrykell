import { test, expect } from '@playwright/test';
import { setupTauriMock, ensureTabsOpen } from './tauri-mock';

const tabIds = (page: import('@playwright/test').Page) =>
  page.locator('[data-tab-row-id]')
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.tabRowId!));

test('collapsed group drops its colored edge and shows the tab surface only while active, hovered or dragged', async ({ page }, info) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
  await page.keyboard.press('Meta+t');
  await ensureTabsOpen(page);

  const first = (await tabIds(page))[0]!;
  await page.getByTestId(`tab-row-${first}`).click({ button: 'right' });
  await page.getByRole('button', { name: '新建分组', exact: true }).click();
  // Creating a group opens its name field in the action menu.
  await expect(page.getByRole('textbox', { name: '分组名称' })).toBeFocused();
  await page.keyboard.press('Enter');

  const xtermBg = await page.evaluate(() => {
    const element = document.createElement('div');
    element.style.background = 'var(--xterm-bg)';
    document.body.append(element);
    const color = getComputedStyle(element).backgroundColor;
    element.remove();
    return color;
  });
  const group = page.locator('[data-group-id]').first();
  await expect(group).toBeVisible();
  const card = group.locator('xpath=..');
  const header = group.locator('.tab-group-header');
  const beforeCollapse = (await header.boundingBox())!;
  // Expanded keeps the colored edge (an overlay, so it never shortens the tabs) and the plain header.
  await expect(card).toHaveCSS('border-bottom-width', '0px');
  expect(await card.evaluate(element => getComputedStyle(element, '::after').height)).toBe('2px');
  await expect(header).not.toHaveAttribute('data-tab-surface');

  await header.click();
  await expect(page.getByTestId(/^group-count-/)).toHaveCount(0);
  // Make the grouped tab the active one: the collapsed group merges with the body without the edge.
  await page.evaluate(async (groupId) => {
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    const state = useWorkspaceStore.getState();
    const grouped = state.tabs.find(tab => tab.kind === 'session' && tab.groupId === groupId);
    if (grouped) useWorkspaceStore.setState({ activeId: grouped.id });
  }, await group.getAttribute('data-group-id'));
  await page.mouse.move(700, 300);
  await expect(card).toHaveCSS('border-bottom-width', '0px');
  expect(await card.evaluate(element => getComputedStyle(element, '::after').display)).toBe('none');
  await expect(header).toHaveAttribute('data-tab-surface', 'true');
  await expect(header).toHaveCSS('background-color', xtermBg);
  expect(Math.abs((await header.boundingBox())!.x - beforeCollapse.x)).toBeLessThan(1);
  await page.screenshot({ path: info.outputPath('collapsed-group-edge-dark.png'), animations: 'disabled' });

  // Handing the active tab to a loose tab clears the surface and keeps the edge away.
  await page.locator(`[data-tab-row-id]:not([data-tab-row-id="${first}"])`).first().click();
  await page.mouse.move(700, 300);
  await expect(header).not.toHaveAttribute('data-tab-surface');
  await expect(card).toHaveCSS('border-bottom-width', '0px');
  await expect(header).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

  // Hovering the collapsed group shows the tab surface; leaving hides it again.
  await header.hover();
  await expect(header).toHaveAttribute('data-tab-surface', 'true');
  await expect(header).toHaveCSS('background-color', xtermBg);
  await page.mouse.move(700, 300);
  await expect(header).not.toHaveAttribute('data-tab-surface');

  await header.click();
  await expect(card).toHaveCSS('border-bottom-width', '0px');
  expect(await card.evaluate(element => getComputedStyle(element, '::after').height)).toBe('2px');
  await expect(header).not.toHaveAttribute('data-tab-surface');
  expect(Math.abs((await header.boundingBox())!.x - beforeCollapse.x)).toBeLessThan(1);
});

test('group actions and colors open from the chip without squeezing its title', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
  await page.keyboard.press('Meta+t');
  await ensureTabsOpen(page);

  const first = (await tabIds(page))[0]!;
  await page.getByTestId(`tab-row-${first}`).click({ button: 'right' });
  await page.getByRole('button', { name: '新建分组', exact: true }).click();
  await page.keyboard.press('Enter');

  const group = page.locator('[data-group-id]').first();
  const header = group.locator('.tab-group-header');
  const title = page.getByTestId(/^group-title-/).first();
  await expect(title).toBeVisible();

  // The mouse resting outside the header: this is the width the title column owns.
  await page.mouse.move(700, 300);
  const resting = (await title.boundingBox())!.width;
  await header.hover();
  const hovered = (await title.boundingBox())!.width;
  // The action buttons must not take title space: revealing them changes nothing.
  expect(hovered).toBeGreaterThanOrEqual(resting - 1);

  await header.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: '分组操作' });
  const rename = menu.getByRole('textbox', { name: '分组名称' });
  await expect(rename).toBeVisible();
  const palette = menu.getByRole('menuitemradio').first();
  expect((await palette.boundingBox())!.y).toBeGreaterThan((await menu.getByRole('button', { name: '归档分组' }).boundingBox())!.y);
  expect((await title.boundingBox())!.width).toBe(resting);
  await page.keyboard.press('Escape');
  await expect(header).toBeFocused();
});

test('tab rename input stays inside its row', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
  await ensureTabsOpen(page);

  const row = page.locator('[data-tab-row-id]').first();
  await row.dblclick();
  const input = row.getByRole('textbox');
  await expect(input).toBeVisible();
  const rowBox = (await row.boundingBox())!;
  const inputBox = (await input.boundingBox())!;
  expect(inputBox.x + inputBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 1);
  await input.press('Escape');
});
