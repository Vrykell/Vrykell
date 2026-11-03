import { test, expect, type Page } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

const button = (page: Page, id: string) => page.locator(`[data-dock-btn="${id}"]`);
const zone = (page: Page) => page.locator('[data-dock-zone="right"]');
const order = (page: Page) => zone(page).locator('[data-dock-btn]').evaluateAll(elements => elements.map(element => element.getAttribute('data-dock-btn')));
const panel = (page: Page) => page.locator('.workspace-side-panel[data-side="right"]:visible');

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.addInitScript(() => {
    for (const type of ['dragstart', 'dragover', 'drop']) document.addEventListener(type, event => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
  });
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
});

test('auxiliary actions reorder horizontally and retain their order and open panel after reload', async ({ page }) => {
  await button(page, 'files').click();
  await button(page, 'files').dragTo(button(page, 'chat'), { targetPosition: { x: 28, y: 16 } });
  expect(await order(page)).toEqual(['git', 'command-history', 'chat', 'files']);
  await expect(panel(page).getByText('notes.txt')).toBeVisible();
  await page.reload();
  expect(await order(page)).toEqual(['git', 'command-history', 'chat', 'files']);
  await expect(panel(page).getByText('notes.txt')).toBeVisible();
  await expect(page.locator('.workspace-side-panel[data-side="left"]')).toHaveCount(0);
});

test('reordering and hiding the assistant keep its conversation draft and right placement', async ({ page }) => {
  await button(page, 'chat').click();
  const composer = page.locator('[data-chat-composer]:visible');
  await composer.fill('Preserve this draft');
  await button(page, 'chat').dragTo(button(page, 'files'), { targetPosition: { x: 4, y: 16 } });
  expect((await order(page))[0]).toBe('chat');
  await expect(panel(page).locator('[data-chat-composer]')).toHaveValue('Preserve this draft');
  await button(page, 'chat').click(); await expect(composer).toBeHidden();
  await button(page, 'chat').click(); await expect(composer).toHaveValue('Preserve this draft');
  await page.reload();
  await expect(panel(page).locator('[data-chat-composer]')).toBeVisible();
  expect((await order(page))[0]).toBe('chat');
});

test('narrow windows keep all fixed and auxiliary controls inside the application', async ({ page }, info) => {
  for (const width of [760, 560]) {
    await page.setViewportSize({ width, height: 500 });
    await expect(page.getByTestId('workspace-sidebar')).toBeHidden();
    await expect(page.getByTestId('workspace-sidebar-expand')).toBeVisible();
    await expect(page.getByTestId('auxiliary-more')).toBeVisible();
    for (const id of ['files', 'git']) {
      const bounds = (await button(page, id).boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    }
    await page.getByTestId('auxiliary-more').click();
    await expect(page.getByRole('menuitemradio', { name: 'AI 助手', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitemradio', { name: '历史命令', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.screenshot({ path: info.outputPath(`fixed-navigation-${width}.png`) });
  }
  const before = await order(page);
  await button(page, 'files').dragTo(page.getByTestId('global-search-trigger'));
  expect(await order(page)).toEqual(before);
});

test('Escape cancels the preview without toggling or saving a panel', async ({ page }) => {
  const saved = await page.evaluate(() => localStorage.getItem('dock-layout-v6'));
  const source = (await button(page, 'files').boundingBox())!, target = (await button(page, 'chat').boundingBox())!;
  await page.mouse.move(source.x + 16, source.y + 16); await page.mouse.down();
  await page.mouse.move(target.x + 12, target.y + 16, { steps: 8 });
  await expect(zone(page)).toHaveAttribute('data-drop-active', 'true');
  await page.keyboard.press('Escape'); await page.mouse.up();
  expect(await order(page)).toEqual(['files', 'git', 'command-history', 'chat']);
  expect(await page.evaluate(() => localStorage.getItem('dock-layout-v6'))).toBe(saved);
  await expect(panel(page)).toHaveCount(0);
  await button(page, 'files').click(); await expect(panel(page).getByText('notes.txt')).toBeVisible();
});

test('search stays centered within the whole application and never overlaps actions', async ({ page }) => {
  for (const width of [1550, 1240, 900, 720]) {
    await page.setViewportSize({ width, height: 600 });
    await expect.poll(async () => {
      const search = (await page.getByTestId('global-search-trigger').boundingBox())!;
      const header = (await page.locator('.application-window').boundingBox())!;
      return Math.abs(search.x + search.width / 2 - header.x - header.width / 2);
    }).toBeLessThan(1);
    const search = (await page.getByTestId('global-search-trigger').boundingBox())!;
    const actions = (await page.locator('.workspace-title-actions').boundingBox())!;
    expect(search.x + search.width).toBeLessThanOrEqual(actions.x - 4);
    expect(actions.x + actions.width).toBeLessThanOrEqual(width);
  }
});

test('settings is fixed at the foot of the full-height sidebar and remains keyboard accessible', async ({ page }) => {
  const settings = button(page, 'settings');
  await expect(settings).toHaveAttribute('data-dock-fixed', 'true');
  const box = (await settings.boundingBox())!, last = (await button(page, 'ssh').boundingBox())!;
  expect(box.y).toBeGreaterThan(last.y + last.height);
  await settings.focus(); await settings.press('Enter');
  await expect(page.locator('.settings-screen')).toBeVisible();
  await expect(settings).toHaveAttribute('aria-pressed', 'true');
  await settings.press('Enter');
  await expect(page.locator('.settings-screen')).toHaveCount(0);
});

test('a toolbar drag reserves a stable shared insertion gap before saving', async ({ page }) => {
  const source = (await button(page, 'chat').boundingBox())!, target = (await button(page, 'files').boundingBox())!;
  const saved = await page.evaluate(() => localStorage.getItem('dock-layout-v6'));
  await page.mouse.move(source.x + 16, source.y + 16); await page.mouse.down();
  await page.mouse.move(target.x + 4, target.y + 16, { steps: 8 });
  const gap = zone(page).locator('[data-dock-placeholder="0"]'); await expect(gap).toBeVisible();
  await expect(gap).toHaveCSS('border-width', '0px');
  const bounds = (await gap.boundingBox())!;
  expect(bounds.width).toBe(32); expect(bounds.height).toBe(32);
  for (const delta of [-1, 0, 1]) {
    await page.mouse.move(bounds.x + bounds.width / 2 + delta, bounds.y + bounds.height / 2);
    expect((await gap.boundingBox())!.x).toBe(bounds.x);
  }
  expect(await page.evaluate(() => localStorage.getItem('dock-layout-v6'))).toBe(saved);
  await page.mouse.up(); expect((await order(page))[0]).toBe('chat');
  await expect(page.locator('[data-dock-placeholder]')).toHaveCount(0);
});

for (const theme of ['dark', 'light'] as const) {
  for (const width of [1240, 720]) {
    test(`drag insertion slots have no edge borders in ${theme} at ${width}px`, async ({ page }, info) => {
      await page.addInitScript(mode => localStorage.setItem('vrykell-theme-mode', mode), theme);
      await page.setViewportSize({ width, height: 800 });
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

      const source = (await button(page, 'git').boundingBox())!;
      const target = (await button(page, 'files').boundingBox())!;
      await page.mouse.move(source.x + 16, source.y + 16);
      await page.mouse.down();
      await page.mouse.move(target.x + 4, target.y + 16, { steps: 8 });
      const toolbarSlot = zone(page).locator('[data-dock-placeholder="0"]');
      await expect(toolbarSlot).toBeVisible();
      await expect(toolbarSlot).toHaveCSS('border-width', '0px');
      await expect(toolbarSlot).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await page.screenshot({ path: info.outputPath('toolbar-slot.png') });
      await page.keyboard.press('Escape');
      await page.mouse.up();
      await expect(toolbarSlot).toHaveCount(0);

      const expand = page.getByTestId('workspace-sidebar-expand');
      if (await expand.isVisible()) await expand.click();
      const row = page.getByTestId('workspace-area-unified');
      const rowBox = (await row.boundingBox())!;
      const destination = (await page.getByTestId('workspace-area-ssh').boundingBox())!;
      await page.mouse.move(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(destination.x + destination.width / 2, destination.y + destination.height + 40, { steps: 8 });
      const sidebarSlot = page.locator('[data-reorder-placeholder]');
      await expect(sidebarSlot).toBeVisible();
      await expect(sidebarSlot).toHaveAttribute('data-reorder-placeholder', 'ssh');
      await expect(sidebarSlot).toHaveCSS('border-width', '0px');
      await expect(sidebarSlot).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      expect((await sidebarSlot.boundingBox())!.height).toBe(rowBox.height);
      await page.screenshot({ path: info.outputPath('sidebar-slot.png') });
      const firstRow = (await page.getByTestId('workspace-area-terminal').boundingBox())!;
      await page.mouse.move(firstRow.x + firstRow.width / 2, firstRow.y + 1, { steps: 8 });
      await expect(sidebarSlot).toHaveAttribute('data-reorder-placeholder', 'terminal');
      await page.keyboard.press('Escape');
      await page.mouse.up();
      await expect(sidebarSlot).toHaveCount(0);
      await expect(row).toBeVisible();
    });
  }
}

test('crossing sides previews the real panel surface and moving a left panel back keeps it usable', async ({ page }, info) => {
  await page.evaluate(async () => {
    const { useDockStore } = await import('/src/features/workspace/stores/dock.ts');
    useDockStore.getState().moveButton('files', 'left');
    useDockStore.getState().openPanel('files');
  });
  // The left dock shows one panel with its own heading and no button row.
  const leftPanel = page.locator('.workspace-side-panel[data-side="left"][data-visible="true"]');
  await expect(leftPanel).toBeVisible();
  await expect(page.locator('[data-dock-zone="left"] [data-dock-btn]')).toHaveCount(0);
  await expect(page.getByTestId('panel-drag-handle-files')).toBeVisible();

  // Dragging the left panel's heading back to the right dock previews the real right surface.
  const heading = (await page.getByTestId('panel-drag-handle-files').boundingBox())!;
  const rightTarget = (await button(page, 'command-history').boundingBox())!;
  await page.mouse.move(heading.x + 24, heading.y + heading.height / 2); await page.mouse.down();
  await page.mouse.move(rightTarget.x + rightTarget.width / 2, rightTarget.y + rightTarget.height / 2, { steps: 8 });
  const preview = page.getByTestId('panel-drop-preview');
  await expect(preview).toHaveAttribute('data-side', 'right');
  const previewBox = (await preview.boundingBox())!;
  const bodyBox = (await page.locator('.workspace-body').boundingBox())!;
  expect(previewBox.y).toBeGreaterThanOrEqual(bodyBox.y);
  await expect(page.locator('[data-dock-zone="right"] [data-dock-placeholder]')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('left-to-right-panel-preview.png'), animations: 'disabled' });
  await page.mouse.up();
  await expect(page.locator('.workspace-side-panel[data-side="right"][data-visible="true"]').getByText('notes.txt')).toBeVisible();
});

test('workspace navigation rows reorder vertically and retain their order', async ({ page }) => {
  const source = (await page.getByTestId('workspace-area-ssh').boundingBox())!;
  const target = (await page.getByTestId('workspace-area-terminal').boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + 1, { steps: 8 });
  await expect(page.locator('[data-reorder-preview]')).toBeVisible();
  await expect(page.locator('[data-reorder-placeholder]')).toHaveCSS('border-width', '0px');
  await page.mouse.up();
  const order = () => page.locator('[data-testid^="workspace-area-"]').evaluateAll(rows =>
    rows.map(row => row.getAttribute('data-testid')?.replace('workspace-area-', '')));
  await expect.poll(order).toEqual(['ssh', 'terminal', 'code', 'ai', 'unified']);
  await page.reload();
  await expect.poll(order).toEqual(['ssh', 'terminal', 'code', 'ai', 'unified']);

  // Dropping past the last row, in the empty sidebar area below the list, appends the row.
  const terminal = (await page.getByTestId('workspace-area-terminal').boundingBox())!;
  const last = (await page.getByTestId('workspace-area-unified').boundingBox())!;
  await page.mouse.move(terminal.x + terminal.width / 2, terminal.y + terminal.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width / 2, last.y + last.height + 40, { steps: 10 });
  await page.mouse.up();
  await expect.poll(order).toEqual(['ssh', 'code', 'ai', 'unified', 'terminal']);
});

test('navigation keeps the end slot and the docked panel stable while dragging below the list', async ({ page }) => {
  await page.evaluate(async () => {
    const { useDockStore } = await import('/src/features/workspace/stores/dock.ts');
    useDockStore.getState().moveButton('files', 'left');
    useDockStore.getState().openPanel('files');
  });
  await expect(page.getByTestId('panel-drag-handle-files')).toBeVisible();
  const order = () => page.locator('[data-testid^="workspace-area-"]').evaluateAll(rows =>
    rows.map(row => row.getAttribute('data-testid')?.replace('workspace-area-', '')));
  const nav = (await page.locator('.workspace-area-navigation').boundingBox())!;
  const tools = page.getByTestId('workspace-left-dock');
  const toolsTop = (await tools.boundingBox())!.y;
  const source = (await page.getByTestId('workspace-area-terminal').boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();

  // Past the list and over the docked panel, the whole container still offers the final slot.
  await page.mouse.move(source.x + source.width / 2, nav.y + nav.height + 300, { steps: 10 });
  await expect(page.locator('[data-reorder-placeholder="unified"]')).toBeVisible();
  expect((await tools.boundingBox())!.y).toBe(toolsTop);

  // Leaving the sidebar reserves the source slot instead of collapsing the list under the pointer.
  await page.mouse.move(nav.x + nav.width + 120, nav.y + nav.height + 100, { steps: 8 });
  await expect(page.locator('[data-reorder-placeholder="terminal"]')).toBeVisible();
  expect((await tools.boundingBox())!.y).toBe(toolsTop);

  await page.mouse.move(source.x + source.width / 2, nav.y + nav.height + 300, { steps: 8 });
  await page.mouse.up();
  await expect.poll(order).toEqual(['code', 'ai', 'ssh', 'unified', 'terminal']);
});

test('panel headings retain their appearance and offer the left middle and right edge', async ({ page }, info) => {
  await button(page, 'files').click();
  const heading = page.getByTestId('panel-drag-handle-files');
  const background = await heading.evaluate(element => getComputedStyle(element).backgroundColor);
  await heading.hover(); await expect(heading).toHaveCSS('cursor', 'grab');
  expect(await heading.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(background);
  const start = (await heading.boundingBox())!, body = (await page.locator('.workspace-body').boundingBox())!;
  await page.mouse.move(start.x + 24, start.y + start.height / 2); await page.mouse.down();
  const left = (await page.getByTestId('workspace-left-dock').boundingBox())!;
  await page.mouse.move(left.x + 50, left.y + 100, { steps: 8 });
  await expect(page.getByTestId('panel-drop-preview')).toHaveAttribute('data-side', 'left');
  // The dock preview covers the widened area that the open panel will occupy.
  const sidebar = (await page.getByTestId('workspace-sidebar').boundingBox())!;
  const preview = (await page.getByTestId('panel-drop-preview').boundingBox())!;
  expect(preview.y + preview.height).toBeCloseTo(sidebar.y + sidebar.height, 0);
  // The preview already renders the docked settings layout.
  await expect(page.locator('.workspace-sidebar-footer')).toHaveCount(0);
  await expect(page.locator('.workspace-sidebar-heading').getByTestId('workspace-settings')).toBeVisible();
  await page.mouse.move(body.x + 50, body.y + 200, { steps: 8 });
  await expect(page.getByTestId('panel-drop-preview')).toHaveCount(0);
  await expect(page.locator('.workspace-sidebar-footer')).toHaveCount(1);
  await expect(page.locator('.workspace-sidebar-heading').getByTestId('workspace-settings')).toHaveCount(0);
  await expect(page.getByTestId('panel-drop-preview')).toHaveCount(0);
  await page.mouse.move(body.x + body.width - 24, body.y + 200, { steps: 8 });
  await expect(page.getByTestId('panel-drop-preview')).toHaveAttribute('data-side', 'right');
  await page.screenshot({ path: info.outputPath('right-panel-placement.png') });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(panel(page).getByText('notes.txt')).toBeVisible();
  await heading.getByRole('button').click(); await expect(panel(page)).toHaveCount(0);
});
