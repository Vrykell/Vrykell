import { test, expect } from '@playwright/test';
import { setupTauriMock, ensureTabsOpen } from './tauri-mock';

const tabIds = (page: import('@playwright/test').Page) =>
  page.locator('[data-tab-row-id]')
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.tabRowId!));

test('group header count stays on a single line while the header is hovered', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
  await page.keyboard.press('Meta+t');
  await ensureTabsOpen(page);

  const first = (await tabIds(page))[0]!;
  await page.getByTestId(`tab-row-${first}`).click({ button: 'right' });
  await page.getByRole('button', { name: '新建分组', exact: true }).click();
  // Creating a group starts inline rename; commit it so the header shows its count again.
  await page.keyboard.press('Enter');

  const group = page.locator('[data-group-id]').first();
  await expect(group).toBeVisible();
  // Hovering reveals the group action buttons.
  await group.locator('.tab-group-header').hover();
  await group.locator('.tab-group-header').click();
  const count = page.getByTestId(/^group-count-/).first();
  await expect(count).toHaveCSS('white-space', 'nowrap');
  expect(await count.evaluate((element) => element.getClientRects().length)).toBe(1);
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
  const rename = menu.getByRole('button', { name: '重命名分组' });
  await expect(rename).toBeVisible();
  const palette = menu.getByRole('menuitemradio').first();
  expect((await palette.boundingBox())!.y).toBeGreaterThan((await rename.boundingBox())!.y);
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
