import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

/** Empty directories keep their expander: expanding renders no empty hint, and the arrow can collapse them again. */
test('expanding an empty folder shows no empty hint and the expander stays to collapse it', async ({ page }) => {
  await setupTauriMock(page);
  await page.addInitScript(() => {
    const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const original = internals.invoke;
    internals.invoke = (command, args) => command === 'fs_list' && args?.path === '/home/e2e/Documents'
      ? Promise.resolve([])
      : original(command, args);
  });
  await page.goto('/');
  await page.locator('[data-dock-btn="files"]').click();

  const tree = page.getByTestId('local-file-tree');
  const documents = tree.locator('[data-testid="file-row"][data-path="/home/e2e/Documents"]');
  const expander = documents.locator('[data-testid="file-row-expander"]');
  await expander.click();

  // An empty directory renders no placeholder/hint row and leaves no loading hint behind
  await expect(tree.locator('[data-testid="file-row-empty"]')).toHaveCount(0);
  await expect(tree.getByText('空文件夹')).toHaveCount(0);
  await expect(tree.getByText('正在读取目录…')).toHaveCount(0);
  // The expander stays: empty directories can be collapsed too
  await expect(expander).toBeVisible();
  await expander.click();
  await expect(expander).toBeVisible();
});

/** Clicking the expander repeatedly only toggles expansion; the row must not treat it as a double click and enter the directory. */
test('clicking the expander repeatedly does not enter the directory', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await page.locator('[data-dock-btn="files"]').click();

  const tree = page.getByTestId('local-file-tree');
  // The mock's subdirectory listing repeats entries with the same name; take the one at the root level
  const documents = tree.locator('[data-testid="file-row"][data-path="/home/e2e/Documents"]').first();
  const expander = documents.locator('[data-testid="file-row-expander"]');
  await expander.click();
  await expander.click();
  await expander.click();

  // Three clicks only toggle expansion: the view stays in the original directory and does not enter Documents through a bubbled dblclick
  await expect(tree).toHaveAttribute('data-path', '/home/e2e/project');
});

/** A slow directory: the hint appears only after the delay and then yields to an empty tree. */
test('the loading hint appears only when directory expansion is slow', async ({ page }) => {
  await setupTauriMock(page);
  await page.addInitScript(() => {
    const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const original = internals.invoke;
    internals.invoke = async (command, args) => {
      if (command === 'fs_list' && args?.path === '/home/e2e/Downloads') {
        await new Promise((resolve) => setTimeout(resolve, 600));
        return [];
      }
      return original(command, args);
    };
  });
  await page.goto('/');
  await page.locator('[data-dock-btn="files"]').click();

  const tree = page.getByTestId('local-file-tree');
  const downloads = tree.locator('[data-testid="file-row"][data-path="/home/e2e/Downloads"]');
  await downloads.locator('[data-testid="file-row-expander"]').click();

  await expect(tree.getByText('正在读取目录…')).toBeVisible();
  await expect(tree.getByText('正在读取目录…')).toHaveCount(0);
  await expect(tree.locator('[data-testid="file-row-empty"]')).toHaveCount(0);
  await expect(downloads.locator('[data-testid="file-row-expander"]')).toBeVisible();
});
