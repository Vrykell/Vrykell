import { expect, test } from '@playwright/test';
import { emitPtyOutput, ptyWrites, setupTauriMock } from './tauri-mock';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.addInitScript(() => {
    const bridge = (window as unknown as {
      __TAURI_INTERNALS__: { invoke: (command: string, args: Record<string, unknown>) => Promise<unknown> };
    }).__TAURI_INTERNALS__;
    const invoke = bridge.invoke;
    const root = '/home/e2e/project';
    const requests: string[] = [];
    (window as unknown as Record<string, unknown>).__FILE_BROWSER_LOADS__ = requests;
    bridge.invoke = async (command, args) => {
      if (command !== 'fs_list') return invoke(command, args);
      const path = args.path as string;
      requests.push(path);
      if (/\/branch-\d+$/.test(path)) {
        return [
          { name: 'nested-notes.txt', path: `${path}/nested-notes.txt`, is_dir: false },
          { name: 'sibling.txt', path: `${path}/sibling.txt`, is_dir: false },
        ];
      }
      return Array.from({ length: 60 }, (_, index) => {
        const name = `branch-${String(index).padStart(2, '0')}`;
        return { name, path: `${root}/${name}`, is_dir: true };
      });
    };
  });
  await page.goto('/');
  await expect(page.locator('.terminal-directory:visible')).toHaveAttribute('title', '/home/e2e/project');
  await page.locator('[data-dock-btn="files"]').click();
  await expect(page.getByTestId('local-file-tree')).toHaveAttribute('data-path', '/home/e2e/project');
});

for (const method of ['double-click', 'context-menu'] as const) {
  test(`opening a nested file via ${method} preserves the tree and scroll`, async ({ page }) => {
    const tree = page.getByTestId('local-file-tree');
    await emitPtyOutput(page, '\x1b]7;file://host/home/e2e/elsewhere\x07');
    await expect(page.locator('.terminal-directory:visible')).toHaveAttribute('title', '/home/e2e/elsewhere');
    await expect(tree).toHaveAttribute('data-path', '/home/e2e/project');
    const branch = tree.locator('[data-testid="file-row"][data-path="/home/e2e/project/branch-30"]');
    await branch.locator('[data-testid="file-row-expander"]').click();
    const file = tree.getByText('nested-notes.txt', { exact: true });
    await expect(file).toBeVisible();
    await file.scrollIntoViewIfNeeded();
    const scrollTop = await tree.evaluate(element => element.scrollTop);
    expect(scrollTop).toBeGreaterThan(0);
    const requestsBefore = await page.evaluate(() =>
      [...(window as unknown as { __FILE_BROWSER_LOADS__: string[] }).__FILE_BROWSER_LOADS__]);

    if (method === 'double-click') await file.dblclick();
    else {
      await file.click({ button: 'right' });
      await page.getByRole('button', { name: '使用终端编辑器打开', exact: true }).click();
    }
    await expect.poll(() => ptyWrites(page)).toContain('vim /home/e2e/project/branch-30/nested-notes.txt\n');
    // Wait for the editor terminal's delayed cwd reports as well as the initial focus switch.
    await emitPtyOutput(page, '\x1b]7;file://host/home/e2e/project/branch-30\x07');
    await expect(page.locator('.terminal-directory:visible')).toHaveAttribute('title', '/home/e2e/project/branch-30');
    await expect(tree).toHaveAttribute('data-path', '/home/e2e/project');
    await expect(tree.getByText('sibling.txt', { exact: true })).toBeVisible();
    await expect.poll(() => tree.evaluate(element => element.scrollTop)).toBe(scrollTop);
    expect(await page.evaluate(() =>
      (window as unknown as { __FILE_BROWSER_LOADS__: string[] }).__FILE_BROWSER_LOADS__)).toEqual(requestsBefore);

    // Explicit browsing still works; switching terminals cannot override the browsed directory.
    await branch.dblclick();
    await expect(tree).toHaveAttribute('data-path', '/home/e2e/project/branch-30');
    await emitPtyOutput(page, '\x1b]7;file://host/home/e2e/project\x07');
    await expect(page.locator('.terminal-directory:visible')).toHaveAttribute('title', '/home/e2e/project');
    await page.keyboard.press('Meta+1');
    await expect(tree).toHaveAttribute('data-path', '/home/e2e/project/branch-30');
  });
}

test('returning to the parent directory restores the selected row and scroll', async ({ page }) => {
  const tree = page.getByTestId('local-file-tree');
  const branch = tree.locator('[data-testid="file-row"][data-path="/home/e2e/project/branch-30"]');
  await branch.scrollIntoViewIfNeeded();
  await branch.click();
  await expect(branch).toHaveAttribute('data-selected', 'true');
  const scrollTop = await tree.evaluate((element) => element.scrollTop);
  expect(scrollTop).toBeGreaterThan(0);

  await branch.dblclick();
  await expect(tree).toHaveAttribute('data-path', '/home/e2e/project/branch-30');
  await expect(tree.getByText('nested-notes.txt', { exact: true })).toBeVisible();

  await page.locator('[data-testid="local-up-btn"]').click();
  await expect(tree).toHaveAttribute('data-path', '/home/e2e/project');
  await expect(branch).toHaveAttribute('data-selected', 'true');
  await expect.poll(() => tree.evaluate((element) => element.scrollTop)).toBe(scrollTop);
});
