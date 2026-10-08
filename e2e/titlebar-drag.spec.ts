import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

/**
 * The runtime starts a window drag only when the element under the cursor carries
 * `data-tauri-drag-region` (and no clickable element without it sits in between),
 * so the contract is checked at real coordinates instead of trusting the markup.
 */
async function elementAt(page: import('@playwright/test').Page, x: number, y: number) {
  return page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py) as HTMLElement | null;
    return el ? { tag: el.tagName, isDragRegion: el.hasAttribute('data-tauri-drag-region') } : null;
  }, [x, y]);
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
    const actions = page.locator('.workspace-title-actions');
    const headerBox = (await header.boundingBox())!;
    const searchBox = (await search.boundingBox())!;
    const actionsBox = (await actions.boundingBox())!;
    const middle = Math.round(headerBox.y + headerBox.height / 2);
    const titleSpan = await page.evaluate(() => {
      const rect = document.querySelector<HTMLElement>('.workspace-title span')!.getBoundingClientRect();
      return { left: Math.round(rect.x), right: Math.round(rect.x + rect.width) };
    });

    // Empty space right of the search field and left of the navigation buttons.
    const gap = Math.round((searchBox.x + searchBox.width + actionsBox.x) / 2);
    expect(gap).toBeGreaterThan(searchBox.x + searchBox.width);
    expect((await elementAt(page, gap, middle))?.isDragRegion).toBe(true);

    // Title text drags the window instead of being inert text.
    expect((await elementAt(page, titleSpan.left + 4, middle))?.isDragRegion).toBe(true);

    // Empty space between the title text and the search field.
    const afterTitle = Math.round((titleSpan.right + searchBox.x) / 2);
    if (afterTitle - titleSpan.right > 8) {
      expect((await elementAt(page, afterTitle, middle))?.isDragRegion).toBe(true);
    }

    // Controls keep their own behaviour: a clickable element without the attribute
    // stops the drag, so clicking them never moves the window.
    const dockButton = (await page.locator('[data-dock-btn]').first().boundingBox())!;
    const controls = page.locator('.window-control-button');
    const windowControl = await controls.count() ? await controls.first().boundingBox() : null;
    for (const target of [searchBox, dockButton, ...(windowControl ? [windowControl] : [])]) {
      const hit = await elementAt(page, Math.round(target.x + target.width / 2), middle);
      expect(hit?.isDragRegion).toBe(false);
    }
  });
}
