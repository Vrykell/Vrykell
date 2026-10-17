import { test, expect, type Page } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

const button = (page: Page, id: string) => page.locator(`[data-dock-btn="${id}"]`);
const zone = (page: Page, side: string) => page.locator(`[data-dock-zone="${side}"]`);
const order = (page: Page, side: string) => zone(page, side).locator('[data-dock-btn]').evaluateAll(elements => elements.map(element => element.getAttribute('data-dock-btn')));
const panel = (page: Page, side: string) => page.locator(`.workspace-side-panel[data-side="${side}"]:visible`);

async function dragToEmptyRight(page: Page, id: string) {
  const source = (await button(page, id).boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  // Start the actual drag before measuring the temporary empty-side drop area.
  await page.mouse.move(source.x + source.width / 2 + 12, source.y + source.height / 2, { steps: 3 });
  await expect(zone(page, 'right')).toHaveAttribute('data-dragging', 'true');
  const target = (await zone(page, 'right').boundingBox())!;
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  // Desktop native file dropping can consume HTML drag events; navigation must not need them.
  await page.addInitScript(() => {
    for (const type of ['dragstart', 'dragover', 'drop']) {
      document.addEventListener(type, event => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
    }
  });
  await page.goto('/');
});

test('both navigation areas reorder, preserve open panels, and retain their layout after reload', async ({ page }) => {
  await button(page, 'files').dragTo(button(page, 'ssh'), { targetPosition: { x: 16, y: 4 } });
  expect(await order(page, 'left')).toEqual(['tabs', 'files', 'ssh', 'command-history']);
  await button(page, 'tabs').dragTo(button(page, 'command-history'), { targetPosition: { x: 16, y: 28 } });
  expect(await order(page, 'left')).toEqual(['files', 'ssh', 'command-history', 'tabs']);
  await expect(page.getByTestId('tab-search')).toBeVisible();
  await button(page, 'files').dragTo(button(page, 'chat'), { targetPosition: { x: 4, y: 16 } });
  await button(page, 'ssh').dragTo(button(page, 'chat'), { targetPosition: { x: 4, y: 16 } });
  expect(await order(page, 'right')).toEqual(['files', 'ssh', 'chat', 'settings']);
  await button(page, 'files').dragTo(button(page, 'chat'), { targetPosition: { x: 28, y: 16 } });
  expect(await order(page, 'right')).toEqual(['ssh', 'chat', 'files', 'settings']);
  await page.reload();
  expect(await order(page, 'left')).toEqual(['command-history', 'tabs']);
  expect(await order(page, 'right')).toEqual(['ssh', 'chat', 'files', 'settings']);
  await button(page, 'files').click();
  await expect(panel(page, 'right').getByText('notes.txt')).toBeVisible();
  await expect(page.getByTestId('tab-search')).toBeVisible();
  await button(page, 'files').click();
  await page.keyboard.press('Meta+p');
  await page.getByPlaceholder('搜索命令…').fill('切换文件面板');
  await page.keyboard.press('Enter');
  await expect(panel(page, 'right').getByText('notes.txt')).toBeVisible();
});

test('open sidebars follow their actions in both directions and keep the AI draft', async ({ page }) => {
  await button(page, 'files').click();
  await button(page, 'files').dragTo(button(page, 'chat'), { targetPosition: { x: 4, y: 16 } });
  await expect(panel(page, 'right').getByText('notes.txt')).toBeVisible();
  await expect(panel(page, 'left')).toHaveCount(0);
  await button(page, 'chat').click();
  await page.getByPlaceholder(/自然语言描述/).fill('保持此草稿');
  await button(page, 'chat').dragTo(button(page, 'tabs'), { targetPosition: { x: 16, y: 4 } });
  await expect(panel(page, 'left').getByPlaceholder(/自然语言描述/)).toHaveValue('保持此草稿');
  await expect(panel(page, 'right')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('ai-sidebar-left.png') });
  await button(page, 'chat').click();
  await expect(page.getByPlaceholder(/自然语言描述/)).toBeHidden();
  await button(page, 'chat').click();
  await expect(panel(page, 'left').getByPlaceholder(/自然语言描述/)).toHaveValue('保持此草稿');
  await page.reload();
  await expect(panel(page, 'left').getByPlaceholder(/自然语言描述/)).toBeVisible();
  expect(await order(page, 'left')).toEqual(['chat', 'tabs', 'ssh', 'command-history']);
});

test('empty sides accept drops, every button fits a narrow window, and outside drops are canceled', async ({ page }) => {
  await button(page, 'settings').dragTo(button(page, 'tabs'), { targetPosition: { x: 16, y: 4 } });
  await button(page, 'chat').dragTo(button(page, 'tabs'), { targetPosition: { x: 16, y: 4 } });
  expect(await order(page, 'right')).toEqual([]);
  await dragToEmptyRight(page, 'files');
  expect(await order(page, 'right')).toEqual(['files']);
  await button(page, 'tabs').dragTo(button(page, 'files'), { targetPosition: { x: 4, y: 16 } });
  await button(page, 'ssh').dragTo(button(page, 'files'), { targetPosition: { x: 4, y: 16 } });
  await button(page, 'chat').dragTo(button(page, 'files'), { targetPosition: { x: 4, y: 16 } });
  await button(page, 'settings').dragTo(button(page, 'files'), { targetPosition: { x: 4, y: 16 } });
  await button(page, 'command-history').dragTo(button(page, 'files'), { targetPosition: { x: 4, y: 16 } });
  expect(await order(page, 'left')).toEqual([]);
  await page.setViewportSize({ width: 720, height: 500 });
  for (const id of ['tabs', 'ssh', 'chat', 'files', 'command-history', 'settings']) {
    const bounds = (await button(page, id).boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(720);
  }
  const before = await order(page, 'right');
  await page.screenshot({ path: test.info().outputPath('navigation-right-narrow.png') });
  await button(page, 'files').dragTo(page.getByTestId('global-search-trigger'));
  expect(await order(page, 'right')).toEqual(before);
  await button(page, 'tabs').dragTo(zone(page, 'left'), { targetPosition: { x: 20, y: 100 } });
  expect(await order(page, 'left')).toEqual(['tabs']);
  await expect(page.locator('[data-dock-zone][data-dragging="true"]')).toHaveCount(0);
});

test('pointer drag cancellation preserves the layout and normal clicks still work', async ({ page }) => {
  const source = (await button(page, 'files').boundingBox())!;
  const target = (await button(page, 'chat').boundingBox())!;
  await expect(button(page, 'files')).toHaveAttribute('draggable', 'false');
  await expect(zone(page, 'right').locator('xpath=..')).not.toHaveAttribute('data-tauri-drag-region');
  await page.mouse.move(source.x + 16, source.y + 16);
  await page.mouse.down();
  await page.mouse.move(target.x + 10, target.y + 16, { steps: 8 });
  await expect(zone(page, 'right')).toHaveAttribute('data-drop-active', 'true');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await order(page, 'left')).toEqual(['tabs', 'ssh', 'files', 'command-history']);
  expect(await order(page, 'right')).toEqual(['chat', 'settings']);
  await expect(page.locator('[data-dock-zone][data-dragging="true"]')).toHaveCount(0);
  await expect(button(page, 'files')).toHaveAttribute('aria-pressed', 'false');
  await button(page, 'files').click();
  await expect(panel(page, 'left').getByText('notes.txt')).toBeVisible();
});

test('search stays centered after adding right-side actions and resizing the window', async ({ page }) => {
  await page.setViewportSize({ width: 1550, height: 900 });
  const search = page.getByTestId('global-search-trigger');
  const originalWidth = (await search.boundingBox())!.width;
  await button(page, 'ssh').dragTo(button(page, 'chat'), { targetPosition: { x: 4, y: 16 } });
  expect(await order(page, 'right')).toEqual(['ssh', 'chat', 'settings']);
  const assertGeometry = async (width: number) => {
    await expect.poll(async () => {
      const rect = (await search.boundingBox())!;
      return Math.abs(rect.x + rect.width / 2 - width / 2);
    }).toBeLessThan(1);
    const searchBounds = (await search.boundingBox())!;
    const actions = (await page.locator('.workspace-title-actions').boundingBox())!;
    expect(searchBounds.x + searchBounds.width).toBeLessThanOrEqual(actions.x - 4);
    expect(actions.x + actions.width).toBeLessThanOrEqual(width);
    for (const id of await order(page, 'right')) await expect(button(page, id!)).toBeVisible();
  };
  await assertGeometry(1550);
  expect((await search.boundingBox())!.width).toBe(originalWidth);
  await page.screenshot({ path: test.info().outputPath('two-right-actions-centered.png') });
  for (const id of ['files', 'tabs']) {
    await button(page, id).dragTo(button(page, 'chat'), { targetPosition: { x: 4, y: 16 } });
    await assertGeometry(1550);
  }
  for (const width of [1240, 900, 720, 1550]) {
    await page.setViewportSize({ width, height: 600 });
    await assertGeometry(width);
  }
  expect((await search.boundingBox())!.width).toBe(originalWidth);
  await page.reload();
  await assertGeometry(1550);
});

test('settings reorders on either side, survives reload, and opens one settings page', async ({ page }) => {
  await button(page, 'settings').dragTo(button(page, 'chat'), { targetPosition: { x: 4, y: 16 } });
  expect(await order(page, 'right')).toEqual(['settings', 'chat']);
  await button(page, 'settings').dragTo(button(page, 'tabs'), { targetPosition: { x: 16, y: 4 } });
  expect(await order(page, 'left')).toEqual(['settings', 'tabs', 'ssh', 'files', 'command-history']);
  await expect(button(page, 'settings')).toHaveCount(1);
  await page.reload();
  expect(await order(page, 'left')).toEqual(['settings', 'tabs', 'ssh', 'files', 'command-history']);
  await button(page, 'settings').click();
  await expect(page.locator('.settings-view')).toBeVisible();
  await expect(button(page, 'settings')).toHaveAttribute('aria-pressed', 'true');
  await button(page, 'settings').click();
  await expect(page.locator('.settings-view')).toHaveCount(1);
  await page.keyboard.press('Meta+1');
  await expect(page.locator('.settings-view')).toBeHidden();
  await button(page, 'settings').dragTo(button(page, 'files'), { targetPosition: { x: 16, y: 28 } });
  expect(await order(page, 'left')).toEqual(['tabs', 'ssh', 'files', 'settings', 'command-history']);
  await button(page, 'settings').dragTo(button(page, 'chat'), { targetPosition: { x: 28, y: 16 } });
  expect(await order(page, 'right')).toEqual(['chat', 'settings']);
  await page.reload();
  await button(page, 'settings').click();
  await expect(page.locator('.settings-view')).toBeVisible();
  await expect(button(page, 'settings')).toHaveCount(1);
  await page.setViewportSize({ width: 720, height: 500 });
  const box = (await button(page, 'settings').boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(720);
  await page.screenshot({ path: test.info().outputPath('draggable-settings.png') });
});

test('buttons make room for a stable full-size gap before the layout is saved', async ({ page }) => {
  const saved = await page.evaluate(() => localStorage.getItem('dock-layout-v4'));
  const tabsBefore = (await button(page, 'tabs').boundingBox())!;
  const sshBefore = (await button(page, 'ssh').boundingBox())!;
  const filesBefore = (await button(page, 'files').boundingBox())!;
  await page.mouse.move(filesBefore.x + 16, filesBefore.y + 16);
  await page.mouse.down();
  await page.mouse.move(tabsBefore.x + 16, tabsBefore.y + 4, { steps: 8 });
  const gap = zone(page, 'left').locator('[data-dock-placeholder="0"]');
  await expect(gap).toBeVisible();
  expect(await gap.boundingBox()).toMatchObject({ width: 32, height: 32 });
  expect((await button(page, 'tabs').boundingBox())!.y).toBe(tabsBefore.y + 40);
  expect((await button(page, 'ssh').boundingBox())!.y).toBe(sshBefore.y + 40);
  await expect(button(page, 'files')).toBeHidden();
  await expect(page.locator('.workspace-navigation-drag-preview')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('dock-layout-v4'))).toBe(saved);
  const gapBox = (await gap.boundingBox())!;
  for (let delta = -1; delta <= 1; delta++) {
    await page.mouse.move(gapBox.x + 16 + delta, gapBox.y + 16);
    await expect(gap).toBeVisible();
    expect((await gap.boundingBox())!.y).toBe(gapBox.y);
  }
  await page.screenshot({ path: test.info().outputPath('left-insertion-gap.png') });
  await page.mouse.up();
  expect(await order(page, 'left')).toEqual(['files', 'tabs', 'ssh', 'command-history']);
  await expect(page.locator('[data-dock-placeholder]')).toHaveCount(0);
  await expect(page.locator('.workspace-navigation-drag-preview')).toHaveCount(0);

  const settingsBefore = (await button(page, 'settings').boundingBox())!;
  const chatBefore = (await button(page, 'chat').boundingBox())!;
  const source = (await button(page, 'ssh').boundingBox())!;
  const savedAgain = await page.evaluate(() => localStorage.getItem('dock-layout-v4'));
  await page.mouse.move(source.x + 16, source.y + 16);
  await page.mouse.down();
  await page.mouse.move(settingsBefore.x + 4, settingsBefore.y + 16, { steps: 8 });
  const rightGap = zone(page, 'right').locator('[data-dock-placeholder="1"]');
  await expect(rightGap).toBeVisible();
  const rightSpacing = await zone(page, 'right').locator('.workspace-right-actions')
    .evaluate(element => Number.parseFloat(getComputedStyle(element).columnGap));
  const rightBox = (await rightGap.boundingBox())!;
  expect((await button(page, 'chat').boundingBox())!.x).toBe(chatBefore.x - rightBox.width - rightSpacing);
  expect((await button(page, 'settings').boundingBox())!.x).toBe(settingsBefore.x);
  await page.mouse.move(rightBox.x + 16, rightBox.y + 16);
  await expect(rightGap).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('right-insertion-gap.png') });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('[data-dock-placeholder]')).toHaveCount(0);
  await expect(page.locator('.workspace-navigation-drag-preview')).toHaveCount(0);
  expect((await button(page, 'chat').boundingBox())!.x).toBe(chatBefore.x);
  expect(await order(page, 'right')).toEqual(['chat', 'settings']);
  expect(await page.evaluate(() => localStorage.getItem('dock-layout-v4'))).toBe(savedAgain);
});

test('sidebar headings keep their resting appearance and drag panels through the existing navigation gesture', async ({ page }) => {
  await button(page, 'files').click();
  const heading = page.getByTestId('panel-drag-handle-files');
  const appearance = () => heading.evaluate(element => { const style = getComputedStyle(element); return { background: style.backgroundColor, border: style.borderWidth, shadow: style.boxShadow }; });
  const resting = await appearance(); await heading.hover();
  await expect(heading).toHaveCSS('cursor', 'grab'); expect(await appearance()).toEqual(resting);
  const start = (await heading.boundingBox())!; const body = (await page.locator('.workspace-body').boundingBox())!;
  await page.mouse.move(start.x + 24, start.y + start.height / 2); await page.mouse.down();
  await page.mouse.move(body.x + 90, body.y + 250, { steps: 8 });
  await expect(heading).toHaveCSS('cursor', 'grabbing');
  const preview = page.getByTestId('panel-drop-preview');
  await expect(preview).toHaveAttribute('data-side', 'left');
  await expect(preview).toContainText('松手打开资源');
  await page.screenshot({ path: test.info().outputPath('heading-panel-preview-left.png') });
  await page.mouse.move(body.x + body.width - 24, body.y + 250, { steps: 10 });
  await expect(preview).toHaveAttribute('data-side', 'right'); await page.mouse.up();
  await expect(panel(page, 'right').getByText('notes.txt')).toBeVisible();
  await expect(page.getByTestId('panel-drop-preview')).toHaveCount(0);
  const rightHeading = (await heading.boundingBox())!; const target = (await button(page, 'tabs').boundingBox())!;
  await page.mouse.move(rightHeading.x + 24, rightHeading.y + rightHeading.height / 2); await page.mouse.down();
  await page.mouse.move(target.x + 16, target.y + 4, { steps: 10 }); await page.mouse.up();
  await expect(panel(page, 'left').getByText('notes.txt')).toBeVisible();
  expect((await order(page, 'left'))[0]).toBe('files');
  const saved = await page.evaluate(() => localStorage.getItem('dock-layout-v4'));
  const current = (await heading.boundingBox())!;
  await page.mouse.move(current.x + 24, current.y + current.height / 2); await page.mouse.down();
  await page.mouse.move(body.x + body.width - 24, body.y + 250, { steps: 8 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  expect(await page.evaluate(() => localStorage.getItem('dock-layout-v4'))).toBe(saved);
  await heading.getByRole('button').click(); await expect(panel(page, 'left')).toHaveCount(0);
  await expect(page.locator('[data-dock-zone][data-dragging="true"]')).toHaveCount(0);
  await page.reload(); expect((await order(page, 'left'))[0]).toBe('files');
});
