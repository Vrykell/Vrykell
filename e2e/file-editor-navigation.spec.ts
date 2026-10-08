import { expect, test } from '@playwright/test';
import { emitPtyOutput, fsOps, ptyWrites, setupTauriMock } from './tauri-mock';

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
          { name: 'nested-dir', path: `${path}/nested-dir`, is_dir: true },
          { name: 'nested-notes.txt', path: `${path}/nested-notes.txt`, is_dir: false },
          { name: 'sibling.txt', path: `${path}/sibling.txt`, is_dir: false },
        ];
      }
      if (path.endsWith('/nested-dir')) {
        return [{ name: 'deep.txt', path: `${path}/deep.txt`, is_dir: false }];
      }
      return Array.from({ length: 60 }, (_, index) => {
        const name = `branch-${String(index).padStart(2, '0')}`;
        return { name, path: `${root}/${name}`, is_dir: true };
      });
    };
  });
  await page.goto('/');
  await expect(page.locator('.terminal-directory:visible')).toHaveAttribute('data-tip', '/home/e2e/project');
  await page.locator('[data-dock-btn="files"]').click();
  await expect(page.getByTestId('local-file-tree')).toHaveAttribute('data-path', '/home/e2e/project');
});

for (const method of ['double-click', 'context-menu'] as const) {
  test(`opening a nested file via ${method} preserves the tree and scroll`, async ({ page }) => {
    const tree = page.getByTestId('local-file-tree');
    await emitPtyOutput(page, '\x1b]7;file://host/home/e2e/elsewhere\x07');
    await expect(page.locator('.terminal-directory:visible')).toHaveAttribute('data-tip', '/home/e2e/elsewhere');
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
    await expect(page.locator('[data-tab-row-id]').filter({ hasText: 'nested-notes.txt' }).locator('[data-shell-mark="zsh"]')).toHaveCount(1);
    // Wait for the editor terminal's delayed cwd reports as well as the initial focus switch.
    await emitPtyOutput(page, '\x1b]7;file://host/home/e2e/project/branch-30\x07');
    await expect(page.locator('.terminal-directory:visible')).toHaveAttribute('data-tip', '/home/e2e/project/branch-30');
    await expect(tree).toHaveAttribute('data-path', '/home/e2e/project');
    await expect(tree.getByText('sibling.txt', { exact: true })).toBeVisible();
    await expect.poll(() => tree.evaluate(element => element.scrollTop)).toBe(scrollTop);
    expect(await page.evaluate(() =>
      (window as unknown as { __FILE_BROWSER_LOADS__: string[] }).__FILE_BROWSER_LOADS__)).toEqual(requestsBefore);

    // Explicit browsing still works; switching terminals cannot override the browsed directory.
    await branch.dblclick();
    await expect(tree).toHaveAttribute('data-path', '/home/e2e/project/branch-30');
    await emitPtyOutput(page, '\x1b]7;file://host/home/e2e/project\x07');
    await expect(page.locator('.terminal-directory:visible')).toHaveAttribute('data-tip', '/home/e2e/project');
    await page.keyboard.press('Meta+1');
    await expect(tree).toHaveAttribute('data-path', '/home/e2e/project/branch-30');
  });
}

test('going back restores the previous view selection and scroll', async ({ page }) => {
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

  await page.getByTestId('local-back-btn').click();
  await expect(tree).toHaveAttribute('data-path', '/home/e2e/project');
  await expect(branch).toHaveAttribute('data-selected', 'true');
  await expect.poll(() => tree.evaluate((element) => element.scrollTop)).toBe(scrollTop);
  await expect(page.getByTestId('local-back-btn')).toBeDisabled();
});

test('dragging onto a file row drops into that file parent folder', async ({ page }) => {
  const tree = page.getByTestId('local-file-tree');
  const branch = tree.locator('[data-testid="file-row"][data-path="/home/e2e/project/branch-30"]');
  await branch.scrollIntoViewIfNeeded();
  await branch.locator('[data-testid="file-row-expander"]').click();
  const sibling = tree.locator('[data-testid="file-row"][data-path="/home/e2e/project/branch-30/sibling.txt"]');
  await expect(sibling).toBeVisible();

  // 拖到文件行 = 放进该文件的同级目录（这里即它所在的 branch-30）
  const source = tree.locator('[data-testid="file-row"][data-path="/home/e2e/project/branch-28"]');
  await source.scrollIntoViewIfNeeded();
  const from = await source.boundingBox();
  const to = await sibling.boundingBox();
  await page.mouse.move(from!.x + 40, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to!.x + 40, to!.y + to!.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect.poll(async () => fsOps(page)).toContainEqual({
    op: 'move',
    path: '/home/e2e/project/branch-28',
    destDir: '/home/e2e/project/branch-30',
  });
});

test('going back returns to the previous view, not the parent folder', async ({ page }) => {
  const tree = page.getByTestId('local-file-tree');
  // project 根目录展开 branch-30 后，直接双击其中的嵌套目录进入更深层
  const branch = tree.locator('[data-testid="file-row"][data-path="/home/e2e/project/branch-30"]');
  await branch.locator('[data-testid="file-row-expander"]').click();
  const nestedDir = tree.locator('[data-testid="file-row"][data-path="/home/e2e/project/branch-30/nested-dir"]');
  await nestedDir.dblclick();
  await expect(tree).toHaveAttribute('data-path', '/home/e2e/project/branch-30/nested-dir');
  await expect(tree.getByText('deep.txt', { exact: true })).toBeVisible();

  // 回退 = 上一个视图快照（project 根 + branch-30 展开 + nested-dir 选中），而不是父目录 branch-30
  await page.getByTestId('local-back-btn').click();
  await expect(tree).toHaveAttribute('data-path', '/home/e2e/project');
  await expect(tree.getByText('nested-notes.txt', { exact: true })).toBeVisible();
  await expect(nestedDir).toHaveAttribute('data-selected', 'true');
  await expect(page.getByTestId('local-back-btn')).toBeDisabled();
});
