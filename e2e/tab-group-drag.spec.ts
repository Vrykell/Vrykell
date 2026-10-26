import { expect, test, type Locator, type Page } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

async function drag(page: Page, from: { x: number; y: number; width: number; height: number }, toX: number) {
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(toX, from.y + from.height / 2, { steps: 8 });
}

/** Start a drag from the tab's leading edge and wait for the strip to reflow. */
async function beginDrag(page: Page, source: Locator, y: number) {
  const box = (await source.boundingBox())!;
  await page.mouse.move(box.x + 4, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 24, y, { steps: 2 });
  await expect(source).toHaveAttribute('data-reorder-dragging', 'true');
  await page.waitForTimeout(50);
}

test('groups and loose tabs share one drag order and a dragged group folds only for the gesture', async ({ page }, info) => {
  await setupTauriMock(page, {});
  await page.goto('/');
  await page.locator('[data-tab-row-id]').first().click({ button: 'right' });
  await page.getByRole('button', { name: '新建分组', exact: true }).click();
  await page.getByRole('textbox', { name: '分组名称' }).fill('Team');
  await page.getByRole('textbox', { name: '分组名称' }).press('Enter');
  await page.getByTestId('tab-new-default').click();

  const groupHeader = page.getByTestId(/^group-header-/).first();
  const groupCard = groupHeader.locator('xpath=..').locator('xpath=..');
  await expect(groupCard).toHaveAttribute('data-group-card', 'true');
  await expect(groupCard.locator('[data-group-id] [data-group-id]')).toHaveCount(0);
  expect(await groupCard.evaluate(element => getComputedStyle(element).borderTopWidth)).toBe('0px');
  expect(await groupCard.evaluate(element => getComputedStyle(element).borderBottomWidth)).toBe('0px');
  // The colored edge is an overlay so it never shortens the tabs inside the group.
  expect(await groupCard.evaluate(element => getComputedStyle(element, '::after').height)).toBe('2px');
  expect(await groupCard.evaluate(element => getComputedStyle(element).borderRadius)).toBe('0px');
  expect(await groupHeader.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  expect(await groupHeader.evaluate(element => getComputedStyle(element, '::before').content)).toBe('none');
  await page.screenshot({ path: info.outputPath('group-rest-dark.png'), animations: 'disabled' });
  const restBackground = await groupHeader.evaluate(element => getComputedStyle(element).backgroundColor);
  await groupCard.hover();
  expect(await groupHeader.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(restBackground);
  expect(await groupHeader.evaluate(element => getComputedStyle(element).borderTopLeftRadius)).toBe('8px');
  expect(await groupHeader.evaluate(element => getComputedStyle(element, '::before').content)).toBe('none');
  await page.screenshot({ path: info.outputPath('group-hover-dark.png'), animations: 'disabled' });
  const groupedId = (await page.locator('[data-group-id] [data-tab-row-id]').first().getAttribute('data-tab-row-id'))!;
  const looseRow = page.locator(`[data-tab-row-id]:not([data-tab-row-id="${groupedId}"])`).last();
  let groupBox = (await groupHeader.boundingBox())!;
  let looseBox = (await looseRow.boundingBox())!;
  await drag(page, groupBox, looseBox.x + looseBox.width - 2);
  await expect(page.locator('[data-reorder-preview="item"]')).toContainText('Team');
  await expect(page.locator('[data-reorder-preview="item"] [data-tab-row-id]')).toHaveCount(0);
  await expect(page.getByTestId(`tab-row-${groupedId}`)).toBeHidden();
  await expect(groupHeader).toBeHidden();
  await expect(groupCard).toBeHidden();
  const previewBox = (await page.locator('[data-reorder-preview="item"]').boundingBox())!;
  expect(previewBox.x).toBeGreaterThanOrEqual(0);
  expect(previewBox.x + previewBox.width).toBeLessThanOrEqual(1240);
  expect(Math.abs(previewBox.y - groupBox.y)).toBeLessThanOrEqual(0.5);
  expect(await page.locator('[data-reorder-preview="item"] .terminal-tab-group').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await page.screenshot({ path: info.outputPath('group-drag-dark.png'), animations: 'disabled' });
  await page.mouse.up();
  await expect(page.getByTestId(`tab-row-${groupedId}`)).toBeVisible();
  groupBox = (await groupHeader.boundingBox())!;
  looseBox = (await looseRow.boundingBox())!;
  expect(groupBox.x).toBeGreaterThan(looseBox.x);
  await expect(groupHeader).not.toHaveAttribute('data-header-selected');
});

test('a loose tab entering a group at its first member joins the group instead of swapping the group', async ({ page }) => {
  await setupTauriMock(page, {});
  await page.goto('/');
  await page.locator('[data-tab-row-id]').first().click({ button: 'right' });
  await page.getByRole('button', { name: '新建分组', exact: true }).click();
  await page.getByRole('textbox', { name: '分组名称' }).fill('Inbox');
  await page.getByRole('textbox', { name: '分组名称' }).press('Enter');
  await page.getByTestId('tab-new-default').click();

  const groupHeader = page.getByTestId(/^group-header-/).first();
  const groupId = (await groupHeader.getAttribute('data-group-header-id'))!;
  const groupedRow = page.locator('[data-group-id] [data-tab-row-id]').first();
  const memberId = (await groupedRow.getAttribute('data-tab-row-id'))!;
  const looseId = await page.locator('[data-tab-row-id]').evaluateAll(rows => rows
    .find(row => !row.closest('[data-group-id]'))?.getAttribute('data-tab-row-id'));
  expect(looseId).toBeTruthy();
  const looseRow = page.getByTestId(`tab-row-${looseId}`);
  const source = (await looseRow.boundingBox())!;
  const groupBox = (await groupHeader.boundingBox())!;
  // Grab the tab by its leading edge: the tab's own left edge drives the insertion point.
  await beginDrag(page, looseRow, source.y + source.height / 2);
  // Re-measure after the source left the flow so the leading edge lands in the first member's left half.
  const target = (await groupedRow.boundingBox())!;
  await page.mouse.move(target.x + target.width * 0.3, target.y + target.height / 2, { steps: 6 });
  // The placeholder opens inside the group before its first member, and the group stays put.
  await expect(page.locator(`[data-group-id="${groupId}"] [data-reorder-placeholder="${memberId}"]`)).toHaveCount(1);
  expect(Math.abs((await groupHeader.boundingBox())!.x - groupBox.x)).toBeLessThan(1);
  await page.mouse.up();

  await expect(page.getByTestId(`tab-row-${looseId}`)).toHaveAttribute('data-tab-group', groupId);
  const memberIds = await page.locator(`[data-group-id="${groupId}"] [data-tab-row-id]`).evaluateAll(rows =>
    rows.map(row => row.getAttribute('data-tab-row-id')));
  expect(memberIds[0]).toBe(looseId);
});

test('dragging a loose tab across a leading group never absorbs it', async ({ page }) => {
  await setupTauriMock(page, {});
  await page.goto('/');
  await page.locator('[data-tab-row-id]').first().click({ button: 'right' });
  await page.getByRole('button', { name: '新建分组', exact: true }).click();
  await page.getByRole('textbox', { name: '分组名称' }).fill('Lead');
  await page.getByRole('textbox', { name: '分组名称' }).press('Enter');
  await page.getByTestId('tab-new-default').click();

  const groupHeader = page.getByTestId(/^group-header-/).first();
  const groupId = (await groupHeader.getAttribute('data-group-header-id'))!;
  const group = page.locator('.terminal-tab-group').first();
  const memberId = (await group.locator('[data-tab-row-id]').first().getAttribute('data-tab-row-id'))!;
  const looseId = (await page.locator('[data-tab-row-id]').evaluateAll(rows => rows
    .find(row => !row.closest('[data-group-id]'))?.getAttribute('data-tab-row-id')))!;
  const source = (await page.getByTestId(`tab-row-${looseId}`).boundingBox())!;
  const y = source.y + source.height / 2;
  const moveTo = async (pick: (boxes: { label: { x: number; width: number }; member: { x: number; width: number } }) => number) => {
    const boxes = {
      label: (await groupHeader.boundingBox())!,
      member: (await page.getByTestId(`tab-row-${memberId}`).boundingBox())!,
    };
    await page.mouse.move(pick(boxes), y, { steps: 8 });
  };

  await beginDrag(page, page.getByTestId(`tab-row-${looseId}`), y);
  // Between the label and the first member: the placeholder opens at the group's start.
  await moveTo(boxes => boxes.label.x + boxes.label.width + 6);
  await expect(group.locator(`[data-reorder-placeholder="${memberId}"]`)).toHaveCount(1);
  // Left of the label: the placeholder leaves the group and sits before it.
  await moveTo(boxes => boxes.label.x - 10);
  await expect(group.locator('[data-reorder-placeholder]')).toHaveCount(0);
  const beforeGroup = page.locator(`[data-reorder-placeholder="${groupId}"]`);
  await expect(beforeGroup).toHaveCount(1);
  expect((await beforeGroup.boundingBox())!.x).toBeLessThan((await group.boundingBox())!.x);
  // Past the group's right edge: the placeholder moves to the empty tail instead of staying inside.
  await moveTo(boxes => boxes.member.x + boxes.member.width + 40);
  await expect(page.locator('[data-reorder-zone="ungrouped"] [data-reorder-placeholder]')).toHaveCount(1);
  await page.mouse.up();
  await expect(page.getByTestId(`tab-row-${looseId}`)).toHaveAttribute('data-tab-group', '');
});

test('a collapsed group joins the dragged tab only after the pointer dwells on its label', async ({ page }) => {
  await setupTauriMock(page, {});
  await page.goto('/');
  await page.locator('[data-tab-row-id]').first().click({ button: 'right' });
  await page.getByRole('button', { name: '新建分组', exact: true }).click();
  await page.getByRole('textbox', { name: '分组名称' }).fill('Folded');
  await page.getByRole('textbox', { name: '分组名称' }).press('Enter');
  await page.getByTestId('tab-new-default').click();

  const groupHeader = page.getByTestId(/^group-header-/).first();
  const groupId = (await groupHeader.getAttribute('data-group-header-id'))!;
  const group = page.locator('.terminal-tab-group').first();
  await groupHeader.click();
  await expect(groupHeader).toHaveAttribute('aria-expanded', 'false');
  const looseId = (await page.locator('[data-tab-row-id]').evaluateAll(rows => rows
    .find(row => !row.closest('[data-group-id]'))?.getAttribute('data-tab-row-id')))!;
  const source = (await page.getByTestId(`tab-row-${looseId}`).boundingBox())!;
  const y = source.y + source.height / 2;

  await beginDrag(page, page.getByTestId(`tab-row-${looseId}`), y);
  const label = (await groupHeader.boundingBox())!;
  await page.mouse.move(label.x + label.width * 0.7, y, { steps: 6 });
  // Default: the tab lands after the collapsed group, outside it.
  const afterGroup = page.locator(`[data-reorder-placeholder="${groupId}"]`);
  await expect(afterGroup).toHaveCount(1);
  expect((await afterGroup.boundingBox())!.x).toBeGreaterThan(label.x);
  await expect(group.locator('[data-reorder-placeholder]')).toHaveCount(0);
  // Dwelling on the label highlights the chip and moves the drop into the group.
  await expect(group).toHaveAttribute('data-drop-into', 'true', { timeout: 3000 });
  await expect(page.locator(`[data-reorder-placeholder="${groupId}"]`)).toHaveCount(1);
  await page.mouse.up();
  // The group is collapsed, so expand it before checking the member row.
  await groupHeader.click();
  await expect(page.getByTestId(`tab-row-${looseId}`)).toHaveAttribute('data-tab-group', groupId);
});
