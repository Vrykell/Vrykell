import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

/** Expanding an empty folder: the settled empty state appears without a loading flash. */
test('展开空文件夹显示空状态且不残留加载提示', async ({ page }) => {
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
  await documents.locator('[data-testid="file-row-expander"]').click();

  await expect(tree.locator('[data-testid="file-row-empty"]')).toHaveText('空文件夹');
  await expect(tree.getByText('正在读取目录…')).toHaveCount(0);
});

/** A slow directory: the hint appears only after the delay and yields to the empty state. */
test('目录展开较慢时才出现加载提示', async ({ page }) => {
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
  await expect(tree.locator('[data-testid="file-row-empty"]')).toHaveText('空文件夹');
  await expect(tree.getByText('正在读取目录…')).toHaveCount(0);
});
