import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

/** Expanding an empty folder renders no placeholder row: the hidden chevron is the signal. */
test('展开空文件夹不显示占位行且不残留加载提示', async ({ page }) => {
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

  // 空目录不渲染任何占位行；折叠箭头隐藏本身已经说明它是空文件夹
  await expect(tree.locator('[data-testid="file-row-empty"]')).toHaveCount(0);
  await expect(tree.getByText('空文件夹')).toHaveCount(0);
  await expect(tree.getByText('正在读取目录…')).toHaveCount(0);
  await expect(documents.locator('[data-testid="file-row-expander"]')).toBeHidden();
});

/** A slow directory: the hint appears only after the delay and then yields to an empty tree. */
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
  await expect(tree.getByText('正在读取目录…')).toHaveCount(0);
  await expect(tree.locator('[data-testid="file-row-empty"]')).toHaveCount(0);
  await expect(downloads.locator('[data-testid="file-row-expander"]')).toBeHidden();
});
