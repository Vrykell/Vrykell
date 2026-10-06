import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

/** 空目录同样保留展开箭头：展开后不渲染任何空提示，箭头可再次收起。 */
test('展开空文件夹不显示空提示，箭头保留可再次收起', async ({ page }) => {
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

  // 空目录不渲染任何占位/提示行，也不残留加载提示
  await expect(tree.locator('[data-testid="file-row-empty"]')).toHaveCount(0);
  await expect(tree.getByText('空文件夹')).toHaveCount(0);
  await expect(tree.getByText('正在读取目录…')).toHaveCount(0);
  // 箭头保留：空目录也能收起
  await expect(expander).toBeVisible();
  await expander.click();
  await expect(expander).toBeVisible();
});

/** 连点展开箭头只切换展开，不应被行当成双击而进入目录。 */
test('连点展开箭头不会进入目录', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await page.locator('[data-dock-btn="files"]').click();

  const tree = page.getByTestId('local-file-tree');
  // mock 的子目录列表会重复同名条目，取根层那一个
  const documents = tree.locator('[data-testid="file-row"][data-path="/home/e2e/Documents"]').first();
  const expander = documents.locator('[data-testid="file-row-expander"]');
  await expander.click();
  await expander.click();
  await expander.click();

  // 三次点击只切换展开：仍停留在原目录，没有因为 dblclick 冒泡而进入 Documents
  await expect(tree).toHaveAttribute('data-path', '/home/e2e/project');
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
  await expect(downloads.locator('[data-testid="file-row-expander"]')).toBeVisible();
});
