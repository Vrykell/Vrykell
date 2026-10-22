import { expect, test, type Page } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

async function drag(page: Page, from: { x: number; y: number; width: number; height: number }, toX: number) {
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(toX, from.y + from.height / 2, { steps: 8 });
}

test('groups and loose tabs share one drag order and a dragged group folds only for the gesture', async ({ page }) => {
  await setupTauriMock(page, { schedulesSeed: [] });
  await page.goto('/');
  await page.locator('[data-tab-row-id]').first().click({ button: 'right' });
  await page.getByRole('button', { name: '新建分组', exact: true }).click();
  await page.getByRole('textbox', { name: '分组名称' }).fill('Team');
  await page.getByRole('textbox', { name: '分组名称' }).press('Enter');
  await page.getByTestId('tab-new-default').click();

  const groupHeader = page.getByTestId(/^group-header-/).first();
  const groupCard = groupHeader.locator('xpath=..').locator('xpath=..');
  await expect(groupCard.locator('[data-group-id] [data-group-id]')).toHaveCount(0);
  expect(await groupCard.evaluate(element => getComputedStyle(element).borderTopColor)).toBe('rgba(0, 0, 0, 0)');
  await groupCard.hover();
  await expect.poll(async () => groupCard.evaluate(element => getComputedStyle(element).borderTopColor)).not.toBe('rgba(0, 0, 0, 0)');
  const groupedId = (await page.locator('[data-group-id] [data-tab-row-id]').first().getAttribute('data-tab-row-id'))!;
  const looseRow = page.locator(`[data-tab-row-id]:not([data-tab-row-id="${groupedId}"])`).last();
  let groupBox = (await groupHeader.boundingBox())!;
  let looseBox = (await looseRow.boundingBox())!;
  await drag(page, looseBox, groupBox.x - looseBox.width + 2);
  await expect(page.locator('[data-reorder-preview="item"]')).toBeVisible();
  const groupId = (await page.locator('[data-group-id]').first().getAttribute('data-group-id'))!;
  const target = await page.evaluate(async () => {
    const { useListReorder } = await import('/src/ui/listReorder.tsx');
    return useListReorder.getState().target;
  });
  expect(target).toMatchObject({ itemId: groupId, after: false });
  await expect(groupHeader).toBeVisible();
  await page.mouse.up();
  const layoutOrder = await page.evaluate(async () => {
    const { useWorkspaceNavigation } = await import('/src/features/workspace/stores/navigation.ts');
    return useWorkspaceNavigation.getState().sessionLayoutOrder;
  });
  expect(layoutOrder[0]).toBe(`tab:${(await looseRow.getAttribute('data-tab-row-id'))!}`);
  groupBox = (await groupHeader.boundingBox())!;
  looseBox = (await looseRow.boundingBox())!;
  expect(looseBox.x).toBeLessThan(groupBox.x);

  await drag(page, groupBox, looseBox.x + looseBox.width - 2);
  await expect(page.locator('[data-reorder-preview="item"]')).toContainText('Team');
  await expect(page.locator('[data-reorder-preview="item"] [data-tab-row-id]')).toHaveCount(0);
  await expect(page.getByTestId(`tab-row-${groupedId}`)).toBeHidden();
  await page.mouse.up();
  await expect(page.getByTestId(`tab-row-${groupedId}`)).toBeVisible();
  groupBox = (await groupHeader.boundingBox())!;
  looseBox = (await looseRow.boundingBox())!;
  expect(groupBox.x).toBeGreaterThan(looseBox.x);
  await expect(groupHeader).not.toHaveAttribute('data-header-selected');
});
