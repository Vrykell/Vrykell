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
  const composer = page.locator('[data-chat-composer]');
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
  const saved = await page.evaluate(() => localStorage.getItem('dock-layout-v5'));
  const source = (await button(page, 'files').boundingBox())!, target = (await button(page, 'chat').boundingBox())!;
  await page.mouse.move(source.x + 16, source.y + 16); await page.mouse.down();
  await page.mouse.move(target.x + 12, target.y + 16, { steps: 8 });
  await expect(zone(page)).toHaveAttribute('data-drop-active', 'true');
  await page.keyboard.press('Escape'); await page.mouse.up();
  expect(await order(page)).toEqual(['files', 'git', 'command-history', 'chat']);
  expect(await page.evaluate(() => localStorage.getItem('dock-layout-v5'))).toBe(saved);
  await expect(panel(page)).toHaveCount(0);
  await button(page, 'files').click(); await expect(panel(page).getByText('notes.txt')).toBeVisible();
});

test('search stays centered within the right titlebar and never overlaps actions', async ({ page }) => {
  for (const width of [1550, 1240, 900, 720]) {
    await page.setViewportSize({ width, height: 600 });
    await expect.poll(async () => {
      const search = (await page.getByTestId('global-search-trigger').boundingBox())!;
      const header = (await page.locator('.workspace-titlebar').boundingBox())!;
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
  const saved = await page.evaluate(() => localStorage.getItem('dock-layout-v5'));
  await page.mouse.move(source.x + 16, source.y + 16); await page.mouse.down();
  await page.mouse.move(target.x + 4, target.y + 16, { steps: 8 });
  const gap = zone(page).locator('[data-dock-placeholder="0"]'); await expect(gap).toBeVisible();
  const bounds = (await gap.boundingBox())!;
  expect(bounds.width).toBe(32); expect(bounds.height).toBe(32);
  for (const delta of [-1, 0, 1]) {
    await page.mouse.move(bounds.x + bounds.width / 2 + delta, bounds.y + bounds.height / 2);
    expect((await gap.boundingBox())!.x).toBe(bounds.x);
  }
  expect(await page.evaluate(() => localStorage.getItem('dock-layout-v5'))).toBe(saved);
  await page.mouse.up(); expect((await order(page))[0]).toBe('chat');
  await expect(page.locator('[data-dock-placeholder]')).toHaveCount(0);
});

test('panel headings retain their appearance and only offer a right-edge placement target', async ({ page }, info) => {
  await button(page, 'files').click();
  const heading = page.getByTestId('panel-drag-handle-files');
  const background = await heading.evaluate(element => getComputedStyle(element).backgroundColor);
  await heading.hover(); await expect(heading).toHaveCSS('cursor', 'grab');
  expect(await heading.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(background);
  const start = (await heading.boundingBox())!, body = (await page.locator('.workspace-body').boundingBox())!;
  await page.mouse.move(start.x + 24, start.y + start.height / 2); await page.mouse.down();
  await page.mouse.move(body.x + 50, body.y + 200, { steps: 8 });
  await expect(page.getByTestId('panel-drop-preview')).toHaveCount(0);
  await page.mouse.move(body.x + body.width - 24, body.y + 200, { steps: 8 });
  await expect(page.getByTestId('panel-drop-preview')).toHaveAttribute('data-side', 'right');
  await page.screenshot({ path: info.outputPath('right-panel-placement.png') });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(panel(page).getByText('notes.txt')).toBeVisible();
  await heading.getByRole('button').click(); await expect(panel(page)).toHaveCount(0);
});
