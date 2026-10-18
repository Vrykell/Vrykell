import { test, expect } from '@playwright/test';
import { setupTauriMock, mockAnthropic } from './tauri-mock';
import { gotoSetting } from './settings';

test('page scrollbars stay below an open dialog and become usable again after closing', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await gotoSetting(page, '打开方式');
  await page.setViewportSize({ width: 900, height: 680 });
  const navigation = page.locator('.settings-navigation .scroll-region');
  await expect(navigation).toHaveClass(/overlay-scroll-target/);
  const id = await navigation.getAttribute('id');
  const rail = page.locator(`[role="scrollbar"][aria-controls="${id}"]`);
  await expect(rail).toBeVisible();
  await page.getByTestId('tab-new-btn').click();
  const dialog = page.getByRole('dialog', { name: '新建标签页' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS('opacity', '1');
  await expect.poll(() => dialog.evaluate(element => getComputedStyle(element.parentElement!).opacity)).toBe('1');
  const point = await dialog.evaluate((element, railId) => {
    const popup = element.getBoundingClientRect();
    const bar = document.querySelector(`[role="scrollbar"][aria-controls="${railId}"]`)!.getBoundingClientRect();
    return { x: bar.x + bar.width / 2, y: popup.y + popup.height / 2,
      inside: bar.x >= popup.x && bar.right <= popup.right && popup.y >= bar.y && popup.bottom <= bar.bottom };
  }, id);
  expect(point.inside).toBe(true);
  await expect.poll(() => page.evaluate(point => document.elementFromPoint(point.x, point.y)?.closest('[role="dialog"]')?.getAttribute('aria-label'), point)).toBe('新建标签页');
  await page.mouse.move(point.x, point.y);
  await page.screenshot({ path: test.info().outputPath('dialog-over-settings-scrollbar.png') });
  await dialog.getByPlaceholder('搜索标签页类型…').press('Escape');
  await expect(dialog).toBeHidden();
  await expect.poll(() => page.evaluate(point => document.elementFromPoint(point.x, point.y)?.closest('[role="scrollbar"]')?.getAttribute('aria-controls'), point)).toBe(id);
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, 240);
  await expect.poll(() => navigation.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
});

test('a code block track cannot leave the chat transcript over the composer', async ({ page }) => {
  const code = Array.from({ length: 40 }, (_, row) => `const value_${row} = ${row}; // a line wide enough to overflow horizontally`).join('\n');
  await mockAnthropic(page, `Here is the block:\n\n\`\`\`ts\n${code}\n\`\`\`\n\nAfter the block.`);
  await setupTauriMock(page, { schedulesSeed: [] });
  await page.goto('/');
  await page.locator('[data-dock-btn="chat"]').click();
  await page.locator('[data-chat-composer]').fill('show me a long block');
  await page.locator('[data-chat-composer]').press('Enter');
  const transcript = page.locator('.chat-transcript');
  const surface = transcript.locator('.md pre').first();
  await expect(surface).toBeVisible();
  // The reply's block is taller than the transcript, so the transcript clips its bottom edge.
  await page.setViewportSize({ width: 1240, height: 560 });
  const alignBlockBottom = (offset: number) => transcript.evaluate((scroll, delta) => {
    const pre = scroll.querySelector<HTMLElement>('.md pre')!;
    scroll.scrollTop += pre.getBoundingClientRect().bottom - (scroll.getBoundingClientRect().bottom + delta);
  }, offset);

  // With the block's bottom edge 20px below the transcript, the whole track band is clipped: the
  // point it would occupy belongs to the composer, and no track may answer for it.
  await alignBlockBottom(20);
  const escape = await page.evaluate(() => {
    const scroll = document.querySelector<HTMLElement>('.chat-transcript')!;
    const surface = scroll.querySelector<HTMLElement>('.md pre')!;
    const bar = document.querySelector<HTMLElement>(`[role="scrollbar"][aria-controls="${surface.id}"][aria-orientation="horizontal"]`);
    const bounds = surface.getBoundingClientRect();
    const point = { x: bounds.x + 40, y: bounds.bottom - 5 };
    const hit = document.elementFromPoint(point.x, point.y);
    return {
      clipped: point.y > scroll.getBoundingClientRect().bottom,
      trackDisplay: bar ? getComputedStyle(bar).display : 'missing',
      hitComposer: !!hit?.closest('.chat-composer-wrap'),
      hitTrack: !!hit?.closest('.overlay-scrollbar'),
    };
  });
  expect(escape.clipped).toBe(true);
  expect(escape.trackDisplay).toBe('none');
  expect(escape.hitTrack).toBe(false);
  expect(escape.hitComposer).toBe(true);

  // Back at the block's end the track appears inside the transcript and still drives the block.
  await alignBlockBottom(-2);
  const bar = page.locator(`[role="scrollbar"][aria-controls="${await surface.getAttribute('id')}"][aria-orientation="horizontal"]`);
  await expect(bar).toBeVisible();
  expect(await bar.evaluate(element => {
    const bounds = document.querySelector('.chat-transcript')!.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    return rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1;
  })).toBe(true);
  const track = (await bar.boundingBox())!;
  await page.mouse.click(track.x + track.width - 6, track.y + track.height / 2);
  await expect.poll(() => surface.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await page.mouse.click(track.x + 6, track.y + track.height / 2);
  await expect.poll(() => surface.evaluate(element => element.scrollLeft)).toBe(0);
});
