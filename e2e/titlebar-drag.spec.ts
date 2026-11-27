import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

/**
 * The runtime starts a window drag only when the element under the cursor carries
 * `data-tauri-drag-region` (and no clickable element without it sits in between),
 * so the contract is checked at real coordinates instead of trusting the markup.
 */
async function elementAt(page: import('@playwright/test').Page, x: number, y: number) {
  return page.evaluate(
    ([px, py]) => {
      const el = document.elementFromPoint(px, py) as HTMLElement | null;
      return el ? { tag: el.tagName, isDragRegion: el.hasAttribute('data-tauri-drag-region') } : null;
    },
    [x, y],
  );
}

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.locator('.workspace-titlebar')).toBeVisible();
});

for (const width of [1240, 720]) {
  test(`titlebar exposes drag handles between the controls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const header = page.locator('.workspace-titlebar');
    const search = page.locator('[data-testid="global-search-trigger"]');
    const strip = page.getByTestId('workspace-instance-bar');
    const headerBox = (await header.boundingBox())!;
    const searchBox = (await search.boundingBox())!;
    const middle = Math.round(headerBox.y + headerBox.height / 2);
    const drag = (await header.locator('.workspace-title-drag').boundingBox())!;
    const stripBox = (await strip.boundingBox())!;
    const gap = Math.round(drag.x + drag.width / 2);
    expect(drag.x).toBeGreaterThanOrEqual(stripBox.x + stripBox.width);
    expect(gap).toBeLessThan(searchBox.x);
    expect((await elementAt(page, gap, middle))?.isDragRegion).toBe(true);
    expect((await elementAt(page, Math.round(stripBox.x + stripBox.width / 2), headerBox.y + 1))?.isDragRegion).toBe(true);

    // Controls keep their own behaviour: a clickable element without the attribute
    // stops the drag, so clicking them never moves the window.
    const dockButton = (await header.locator('[data-dock-btn]').first().boundingBox())!;
    const backButton = (await page.getByTestId('workspace-history-back').boundingBox())!;
    const forwardButton = (await page.getByTestId('workspace-history-forward').boundingBox())!;
    const controls = page.locator('.window-control-button');
    const windowControl = (await controls.count()) ? await controls.first().boundingBox() : null;
    const tab = (await strip.getByRole('tab').first().boundingBox())!;
    for (const target of [searchBox, tab, dockButton, ...(windowControl ? [windowControl] : [])]) {
      const hit = await elementAt(page, Math.round(target.x + target.width / 2), middle);
      expect(hit?.isDragRegion).toBe(false);
    }
  });
}

test('workspace tabs use the compact chrome and search keeps its scope', async ({ page }, info) => {
  const strip = page.getByTestId('workspace-instance-bar');
  const context = page.getByTestId('workspace-context-bar');
  const globalSearch = page.getByRole('button', { name: '全局搜索', exact: true });
  const header = page.locator('.workspace-titlebar');
  const sessionSearch = page.getByTestId('tab-search-toggle');

  await expect(header).toHaveCSS('height', '38px');
  await expect(context).toHaveCSS('height', '32px');
  await expect(context).toHaveCSS('box-shadow', 'none');
  await expect(globalSearch.locator('span')).toBeVisible();
  await expect(globalSearch).toHaveCSS('border-top-width', '0px');
  await expect(globalSearch).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const windowControls = page.getByTestId('window-controls');
  if (await windowControls.count())
    expect(await windowControls.evaluate((element) => getComputedStyle(element, '::before').content)).toBe('none');
  await sessionSearch.click();
  await expect(page.getByTestId('tab-search')).toBeFocused();
  await expect(page.getByRole('dialog', { name: '全局搜索' })).toHaveCount(0);
  const contextBox = (await context.boundingBox())!;
  const localBox = (await sessionSearch.boundingBox())!;
  expect(localBox.y).toBeGreaterThanOrEqual(contextBox.y);
  expect(localBox.y + localBox.height).toBeLessThanOrEqual(contextBox.y + contextBox.height);
  await globalSearch.click();
  await expect(page.getByRole('dialog', { name: '全局搜索' })).toBeVisible();
  await page.keyboard.press('Escape');
  await sessionSearch.click();

  for (const area of ['terminal', 'code', 'ai', 'unified']) {
    await page.getByTestId(`workspace-area-${area}`).click();
    const tab = strip.getByRole('tab', { selected: true });
    await expect(tab).toBeVisible();
    const surface = page.locator(area === 'terminal' ? '.workspace-main .terminal-pane:visible' : '.workspace-main').first();
    const color = await surface.evaluate((element) => getComputedStyle(element).backgroundColor);
    await expect(context).toHaveCSS('background-color', color);
    await expect(strip.locator('.folder-tab[data-active="true"]')).toHaveCSS('background-color', color);
    const title = (await header.boundingBox())!;
    const selected = (await tab.boundingBox())!;
    const first = (await strip.locator('.folder-tab:visible').first().boundingBox())!;
    const menu = (await strip.locator('.folder-more-button').boundingBox())!;
    const tail = (await strip.locator('.folder-tab:visible').last().boundingBox())!;
    const creation = strip.locator('.folder-create');
    const create = (await creation.boundingBox())!;
    await expect(creation).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    expect(first.x - menu.x - menu.width).toBeCloseTo(menu.x - title.x, 0);
    expect(first.y - title.y).toBe(5);
    expect(selected.y + selected.height).toBeLessThanOrEqual(title.y + title.height);
    expect(create.y).toBeGreaterThan(title.y);
    expect(create.y + create.height).toBeLessThan(title.y + title.height);
    expect(create.x - tail.x - tail.width).toBeLessThanOrEqual(12);
    expect((await context.boundingBox())!.y).toBe(contextBox.y);
    await page.screenshot({ path: info.outputPath(`compact-chrome-${area}.png`) });
  }
  await page.setViewportSize({ width: 720, height: 600 });
  await expect(globalSearch).toBeVisible();
  await expect(globalSearch.locator('span')).toBeHidden();
  await expect(globalSearch).toHaveAccessibleName('全局搜索');
  await expect(strip.getByRole('tab', { selected: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('compact-chrome-narrow.png') });
});

test('conversation and history toolbars share their content surface with a quiet lower edge', async ({ page }, info) => {
  const strip = page.getByTestId('workspace-instance-bar');
  const context = page.getByTestId('workspace-context-bar');
  const edge = (element: Element) => {
    const style = getComputedStyle(element, '::after');
    return { content: style.content, height: style.height, blur: style.backdropFilter, pointerEvents: style.pointerEvents };
  };
  await page.getByTestId('workspace-area-code').click();
  await expect.poll(() => context.evaluate(edge).then((style) => style.content)).toBe('none');
  await expect(strip.getByRole('button', { name: '打开文件', exact: true }).locator('svg')).toHaveAttribute('viewBox', '0 0 16 16');

  await page.getByTestId('workspace-area-ai').click();
  const create = strip.getByTestId('ai-new-conversation');
  await expect(create.locator('svg')).toHaveAttribute('viewBox', '0 0 16 16');
  await create.click();
  const transcript = page.getByTestId('ai-surface-main').locator('.chat-transcript:visible');
  await expect(transcript).toBeVisible();
  const content = await transcript.evaluate((element) => {
    let surface = element;
    while (getComputedStyle(surface).backgroundColor === 'rgba(0, 0, 0, 0)' && surface.parentElement) surface = surface.parentElement;
    return getComputedStyle(surface).backgroundColor;
  });
  await expect(context).toHaveCSS('background-color', content);
  await expect(strip.locator('.folder-tab[data-active="true"]')).toHaveCSS('background-color', content);
  await expect.poll(() => context.evaluate(edge)).toEqual({ content: '""', height: '6px', blur: 'blur(1px)', pointerEvents: 'none' });
  await page.screenshot({ path: info.outputPath('conversation-embedded-tools.png') });

  await page.getByTestId('workspace-area-terminal').click();
  await strip.getByTestId('tab-history-btn').click();
  const history = page.getByTestId('unified-history-page').locator('.history-header');
  await expect(history).toBeVisible();
  await expect.poll(() => context.evaluate(edge).then((style) => style.content)).toBe('none');
  await expect.poll(() => history.evaluate(edge)).toEqual({ content: '""', height: '6px', blur: 'blur(1px)', pointerEvents: 'none' });
  await history.getByTestId('history-search-toggle').click();
  await expect(history.getByRole('textbox')).toBeFocused();
  await page.screenshot({ path: info.outputPath('history-embedded-tools.png') });
});

test('a docked panel meets the titlebar and narrows the local toolbar', async ({ page }, info) => {
  const context = page.getByTestId('workspace-context-bar');
  const toolbar = page.getByTestId('workspace-instance-bar').locator('.folder-actions');
  const titlebar = page.locator('.workspace-titlebar');
  const originalWidth = (await context.boundingBox())!.width;
  await page.locator('[data-dock-btn="files"]').click();
  const panel = page.locator('.workspace-side-panel[data-side="right"][data-visible="true"]');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('panel-drag-handle-files')).toHaveCSS('height', '32px');
  const titles = (await titlebar.boundingBox())!;
  const aligned = async (previousWidth: number) => {
    const dock = (await panel.boundingBox())!;
    const local = (await toolbar.boundingBox())!;
    const row = (await context.boundingBox())!;
    return (
      dock.y === titles.y + titles.height && row.x + row.width === dock.x && local.x + local.width <= dock.x && row.width < previousWidth
    );
  };
  await expect.poll(() => aligned(originalWidth)).toBe(true);
  const openedWidth = (await context.boundingBox())!.width;
  const handle = (await page.getByTestId('resize-handle-files').boundingBox())!;
  const handleX = handle.x + handle.width / 2;
  const handleY = handle.y + handle.height / 2;
  await page.mouse.move(handleX, handleY);
  await page.mouse.down();
  await page.mouse.move(handleX - 90, handleY, { steps: 8 });
  await expect.poll(() => aligned(openedWidth)).toBe(true);
  await page.mouse.up();
  await page.screenshot({ path: info.outputPath('workspace-toolbar-with-dock.png') });
});

test('a narrow docked workspace shows every local control that fits', async ({ page }, info) => {
  await page.setViewportSize({ width: 720, height: 600 });
  await page.locator('[data-dock-btn="files"]').click();
  const context = page.getByTestId('workspace-context-bar');
  const toolbar = page.getByTestId('workspace-instance-bar').locator('.folder-actions');
  const history = toolbar.getByTestId('tab-history-btn');
  const agent = toolbar.getByTestId('tab-acp-btn');
  await expect.poll(async () => (await context.boundingBox())!.width).toBeLessThan(560);
  await expect(history).toBeVisible();
  await expect(agent).toBeVisible();
  await expect.poll(() => toolbar.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0);
  const row = (await context.boundingBox())!;
  for (const action of [history, agent]) {
    const bounds = (await action.boundingBox())!;
    expect(bounds.x).toBeGreaterThan(row.x);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(row.x + row.width);
    await action.click({ trial: true });
  }
  await page.screenshot({ path: info.outputPath('workspace-toolbar-narrow-dock.png') });
});
