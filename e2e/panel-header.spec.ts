import { test, expect } from '@playwright/test';
import { setupTauriMock, ensureTabsOpen } from './tauri-mock';

const tabIds = (page: import('@playwright/test').Page) =>
  page.locator('[data-reorder-item][data-reorder-kind="tab"]')
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.reorderItem));

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
  // Hovering reveals the group action buttons and squeezes the title column to its narrowest.
  await group.locator('.tab-group-header').hover();
  const count = page.getByTestId(/^group-count-/).first();
  await expect(count).toHaveCSS('white-space', 'nowrap');
  expect(await count.evaluate((element) => element.getClientRects().length)).toBe(1);
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
