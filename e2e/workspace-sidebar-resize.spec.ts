import { expect, test, type Page } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

async function dragStart(page: Page) {
  const bounds = (await page.getByTestId('workspace-sidebar-resize').boundingBox())!;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(bounds.x + bounds.width / 2, y); await page.mouse.down();
  return y;
}

test('sidebar width is bounded, reversible while held, persisted and fully collapsed on release', async ({ page }, info) => {
  await setupTauriMock(page, {}); await page.goto('/');
  const sidebar = page.getByTestId('workspace-sidebar');
  const input = page.locator('[data-terminal-input]').first();
  await input.fill('keep command draft');
  let y = await dragStart(page);
  await page.mouse.move(800, y); await page.mouse.up();
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(400);
  y = await dragStart(page);
  await page.mouse.move(159, y);
  await expect(sidebar).toBeHidden();
  await page.mouse.move(280, y); await page.mouse.up();
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(280);
  await expect(input).toHaveValue('keep command draft');
  const search = (await page.getByTestId('global-search-trigger').boundingBox())!;
  expect(Math.abs(search.x + search.width / 2 - 620)).toBeLessThan(1);
  await page.screenshot({ path: info.outputPath('sidebar-expanded-280.png'), animations: 'disabled' });
  await page.reload();
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(280);
  y = await dragStart(page);
  await page.mouse.move(159, y); await page.mouse.up();
  await expect(sidebar).toBeHidden();
  expect(await sidebar.evaluate(element => element.getBoundingClientRect().width)).toBe(0);
  await page.reload(); await expect(sidebar).toBeHidden();
  await page.getByTestId('workspace-sidebar-expand').click();
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(280);
  const handle = page.getByRole('separator', { name: '调整工作区侧栏宽度' });
  await handle.press('ArrowRight');
  await expect(handle).toHaveAttribute('aria-valuenow', '296');
  await handle.press('Home');
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(208);
  await handle.dblclick();
  await expect(handle).toHaveAttribute('aria-valuenow', '208');
});

test('narrow windows retain manual expansion without consuming the terminal minimum', async ({ page }, info) => {
  await setupTauriMock(page, {}); await page.goto('/');
  const sidebar = page.getByTestId('workspace-sidebar');
  const y = await dragStart(page);
  await page.mouse.move(800, y); await page.mouse.up();
  await page.setViewportSize({ width: 720, height: 800 });
  await expect(sidebar).toBeHidden();
  await page.getByTestId('workspace-sidebar-expand').click();
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(360);
  expect((await page.locator('.workspace-primary').boundingBox())!.width).toBeGreaterThanOrEqual(360);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(720);
  await page.screenshot({ path: info.outputPath('sidebar-narrow-budget.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 1240, height: 800 });
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(400);
});

test('a full terminal grid can open navigation as a temporary overlay without resizing its panes', async ({ page }, info) => {
  await setupTauriMock(page, {}); await page.goto('/');
  const input = page.locator('[data-terminal-input]').first();
  await input.fill('retain the terminal draft');
  await page.evaluate(async () => {
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    useWorkspaceStore.getState().splitFocusedDirect('row');
    useWorkspaceStore.getState().splitFocusedDirect('row');
  });
  const sidebar = page.getByTestId('workspace-sidebar');
  await expect(sidebar).toBeHidden();
  const primary = page.locator('.workspace-primary');
  const before = (await primary.boundingBox())!;
  await page.getByTestId('workspace-sidebar-expand').click();
  await expect(sidebar).toHaveAttribute('data-overlay', 'true');
  await expect(sidebar).toBeVisible();
  expect((await sidebar.boundingBox())!.width).toBe(208);
  expect((await primary.boundingBox())!.width).toBe(before.width);
  expect((await primary.boundingBox())!.x).toBe(before.x);
  await page.screenshot({ path: info.outputPath('sidebar-terminal-grid-overlay.png'), animations: 'disabled' });
  await page.mouse.click(before.x + before.width - 40, before.y + 150);
  await expect(sidebar).toBeHidden();
  await expect(input).toHaveValue('retain the terminal draft');
  await page.getByTestId('workspace-sidebar-expand').click();
  await page.getByTestId('workspace-area-code').click();
  await expect(page.getByTestId('code-start-page')).toBeVisible();
  await expect(sidebar).toBeHidden();
  await page.getByTestId('workspace-sidebar-expand').click();
  await expect(sidebar).toBeVisible();
  await page.getByTestId('workspace-area-terminal').click();
  await expect(sidebar).toBeHidden();
  await page.getByTestId('workspace-sidebar-expand').click();
  await page.keyboard.press('Escape');
  await expect(sidebar).toBeHidden();
  await expect(page.getByTestId('workspace-sidebar-expand')).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1240);
});
