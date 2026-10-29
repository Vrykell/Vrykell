import { test, expect } from '@playwright/test';
import { setupTauriMock, fsOps, revealedPaths, openedPaths, ensureTabsOpen } from './tauri-mock';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  // Open the files panel
  await page.locator('[data-dock-btn="files"]').click();
  await expect(page.getByText('Documents')).toBeVisible({ timeout: 3000 });
});

test.describe('File panel', () => {
  test('a single click selects a file and keeps the panel open', async ({ page }) => {
    const file = page.getByTestId('local-file-tree').locator('[data-testid="file-row"][data-path="/home/e2e/notes.txt"]');
    // A click selects without opening, and the files panel stays open
    await file.click();
    await expect(file).toHaveAttribute('data-selected', 'true');
    await expect(page.getByText('Documents')).toBeVisible();
  });

  test('a click selects a folder, a double click enters it, and the arrow button controls expansion', async ({ page }) => {
    const tree = page.getByTestId('local-file-tree');
    const documents = tree.locator('[data-testid="file-row"][data-path="/home/e2e/Documents"]');
    // A click selects without expanding
    await documents.click();
    await expect(documents).toHaveAttribute('data-selected', 'true');
    await expect(tree.getByText('Documents')).toHaveCount(1);
    // The arrow button expands it (the mock returns the same children for every path, so Documents appears twice after expanding)
    await documents.locator('[data-testid="file-row-expander"]').click();
    await expect(tree.getByText('Documents')).toHaveCount(2);
    // A double click enters the folder and enables the back button
    await documents.first().dblclick();
    await expect(page.getByTestId('local-back-btn')).toBeEnabled();
  });

  test('arrow keys move the selection and Enter enters the folder', async ({ page }) => {
    const tree = page.getByTestId('local-file-tree');
    const documents = tree.locator('[data-testid="file-row"][data-path="/home/e2e/Documents"]');
    const downloads = tree.locator('[data-testid="file-row"][data-path="/home/e2e/Downloads"]');
    // Clicking a row focuses the file list and selects Documents
    await documents.click();
    await expect(documents).toHaveAttribute('data-selected', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(downloads).toHaveAttribute('data-selected', 'true');
    await expect(documents).not.toHaveAttribute('data-selected', 'true');
    await page.keyboard.press('ArrowUp');
    await expect(documents).toHaveAttribute('data-selected', 'true');
    // Enter enters the selected folder and enables the back button
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('local-back-btn')).toBeEnabled();
  });

  test('editable breadcrumb: clicking selects the path, Enter navigates, and Escape or blur cancels', async ({ page }) => {
    const tree = page.getByTestId('local-file-tree');
    const bar = page.getByTestId('crumb-bar');
    const input = page.getByTestId('path-input');
    await expect(tree).toHaveAttribute('data-path', '/home/e2e/project');

    // Clicking the current path enters edit mode with the full path shown and selected
    await bar.locator('[data-tip="单击编辑路径，回车跳转"]').click();
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('/home/e2e/project');
    await input.fill('/home/e2e/Documents');
    await input.press('Enter');
    await expect(tree).toHaveAttribute('data-path', '/home/e2e/Documents');
    await expect(input).toHaveCount(0);

    // Escape cancels editing and keeps the path
    await bar.locator('[data-tip="单击编辑路径，回车跳转"]').click();
    await expect(input).toHaveValue('/home/e2e/Documents');
    await input.press('Escape');
    await expect(input).toHaveCount(0);
    await expect(tree).toHaveAttribute('data-path', '/home/e2e/Documents');

    // Blur cancels editing and keeps the path
    await bar.locator('[data-tip="单击编辑路径，回车跳转"]').click();
    await input.fill('/home/e2e/Downloads');
    await tree.getByText('notes.txt').click();
    await expect(input).toHaveCount(0);
    await expect(tree).toHaveAttribute('data-path', '/home/e2e/Documents');
  });

  test('path bar opens files in the embedded editor and keeps directory navigation', async ({ page }) => {
    const tree = page.getByTestId('local-file-tree');
    const bar = page.getByTestId('crumb-bar');
    await bar.locator('[data-tip="单击编辑路径，回车跳转"]').click();
    await page.getByTestId('path-input').fill('/home/e2e/notes.txt');
    await page.getByTestId('path-input').press('Enter');

    await expect(page.getByTestId('file-editor')).toBeVisible();
    await expect(page.getByTestId('file-editor').locator('.folder-path')).toContainText('/home/e2e/notes.txt');
    await expect(tree).toHaveAttribute('data-path', '/home/e2e/project');
    await expect(page.getByRole('alert')).toHaveCount(0);

    // Directory paths keep navigating as before
    await bar.locator('[data-tip="单击编辑路径，回车跳转"]').click();
    await page.getByTestId('path-input').fill('/home/e2e/Documents');
    await page.getByTestId('path-input').press('Enter');
    await expect(tree).toHaveAttribute('data-path', '/home/e2e/Documents');
  });

  test('the context menu properties dialog shows basic file information', async ({ page }) => {
    await page.locator('[data-testid="file-row"][data-path="/home/e2e/notes.txt"]').click({ button: 'right' });
    await page.getByRole('button', { name: '属性', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: '属性' });
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('file-property-name')).toHaveText('notes.txt');
    await expect(page.getByTestId('file-property-type')).toHaveText('TXT 文件');
    await expect(page.getByTestId('file-property-location')).toHaveText('/home/e2e');
    await expect(page.getByTestId('file-property-size')).toHaveText('1.5 KB');
    await expect(page.getByTestId('file-property-modified')).toContainText('2026');

    // The labeled close action sits in a footer at the bottom right of the panel.
    const close = dialog.getByRole('button', { name: '关闭', exact: true });
    const dialogBounds = (await dialog.boundingBox())!;
    const closeBounds = (await close.boundingBox())!;
    expect(closeBounds.y).toBeGreaterThan(dialogBounds.y + dialogBounds.height / 2);
    expect(closeBounds.x + closeBounds.width / 2).toBeGreaterThan(dialogBounds.x + dialogBounds.width / 2);

    await close.click();
    await expect(dialog).toHaveCount(0);
  });

  test('more menu: offers only locally available actions and can open a new tab from the current folder', async ({ page }) => {
    const tree = page.getByTestId('local-file-tree');
    await expect(tree).toHaveAttribute('data-path', '/home/e2e/project');

    // Local panels cannot upload, so the more menu has no upload entry
    await page.getByTestId('local-more-btn').click();
    await expect(page.getByRole('button', { name: '上传文件' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '下载管理' })).toBeVisible();
    // No undo entries appear before any file operation
    await expect(page.getByRole('button', { name: /^回退/ })).toHaveCount(0);

    // Open a new tab from the current folder (the title comes from the directory name)
    await page.getByRole('button', { name: '从当前文件夹新建标签页' }).click();
    await ensureTabsOpen(page);
    await expect(page.locator('[data-testid^="tab-row-"]', { hasText: 'project' })).toHaveCount(1);

    // Switch back to the files panel; the drive view has no current folder, so the menu hides the unavailable new-tab action
    if (!await tree.isVisible()) await page.locator('[data-dock-btn="files"]').click();
    await expect(tree).toBeVisible();
    await page.getByText('此电脑').click();
    await expect(page.getByTestId('disk-card-e2e-root')).toBeVisible({ timeout: 3000 });
    await page.getByTestId('local-more-btn').click();
    await expect(page.getByRole('button', { name: '从当前文件夹新建标签页' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '下载管理' })).toBeVisible();
  });

  test('the file tree stays in the original directory (remembered within the session) after a downloads round trip instead of returning to the terminal cwd', async ({ page }) => {
    const tree = page.getByTestId('local-file-tree');
    await tree.locator('[data-testid="file-row"][data-path="/home/e2e/Documents"]').dblclick();
    await expect(tree).toHaveAttribute('data-path', '/home/e2e/Documents');

    // Open downloads and go back: the file tree remounts and restores the remembered directory
    await page.getByTestId('local-more-btn').click();
    await page.getByRole('button', { name: '下载管理' }).click();
    await expect(page.getByTestId('downloads-back')).toBeVisible();
    await page.getByTestId('downloads-back').click();
    await expect(tree).toHaveAttribute('data-path', '/home/e2e/Documents');
  });

  test('more menu: switching to the terminal directory moves the panel back to the terminal cwd', async ({ page }) => {
    const tree = page.getByTestId('local-file-tree');
    await expect(tree).toHaveAttribute('data-path', '/home/e2e/project');

    // Enter a subdirectory: the panel decouples from the terminal and no longer follows it automatically
    await tree.locator('[data-testid="file-row"][data-path="/home/e2e/Documents"]').dblclick();
    await expect(tree).toHaveAttribute('data-path', '/home/e2e/Documents');

    // More -> sync to the terminal directory: the panel returns to the terminal cwd
    await page.getByTestId('local-more-btn').click();
    await page.getByRole('button', { name: /^切换到当前终端文件目录/ }).click();
    await expect(tree).toHaveAttribute('data-path', '/home/e2e/project');
  });

  test('Ctrl extends the selection to several rows and the context menu acts on all of them', async ({ page }) => {
    const tree = page.getByTestId('local-file-tree');
    const notes = tree.locator('[data-testid="file-row"][data-path="/home/e2e/notes.txt"]');
    const documents = tree.locator('[data-testid="file-row"][data-path="/home/e2e/Documents"]');

    await notes.click();
    await expect(notes).toHaveAttribute('data-selected', 'true');
    await documents.click({ modifiers: ['ControlOrMeta'] });
    await expect(documents).toHaveAttribute('data-selected', 'true');
    await expect(notes).toHaveAttribute('data-selected', 'true');

    // Right-clicking inside the selection targets the whole group and hides single-row actions
    await notes.click({ button: 'right' });
    await expect(page.getByRole('button', { name: '复制 2 项' })).toBeVisible();
    await expect(page.getByRole('button', { name: '删除 2 项' })).toBeVisible();
    await expect(page.getByRole('button', { name: '重命名' })).toHaveCount(0);
  });

  test('paste target: right-clicking a folder pastes into it, right-clicking a file pastes beside it, and Ctrl+V pastes into the current directory', async ({ page }) => {
    await page.evaluate(() => {
      const ipc = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
      const original = ipc.invoke;
      ipc.invoke = async (command, args) => {
        const result = await original(command, args);
        // Expanded destinations must list their own children rather than repeat the root fixture.
        if (command === 'fs_list' && args?.path === '/home/e2e/Documents') {
          return (result as Array<{ path: string }>).filter(entry => entry.path.slice(0, entry.path.lastIndexOf('/')) === args.path);
        }
        return result;
      };
    });
    const tree = page.getByTestId('local-file-tree');
    const notes = tree.locator('[data-testid="file-row"][data-path="/home/e2e/notes.txt"]');

    // Copy -> right-click a folder: paste into that folder
    await notes.click({ button: 'right' });
    await page.getByRole('button', { name: '复制', exact: true }).click();
    await tree.locator('[data-testid="file-row"][data-path="/home/e2e/Documents"]').click({ button: 'right' });
    await page.getByRole('button', { name: '粘贴', exact: true }).click();
    await expect.poll(async () => (await fsOps(page)).filter((op) => op.op === 'copy'))
      .toContainEqual({ op: 'copy', path: '/home/e2e/notes.txt', destDir: '/home/e2e/Documents' });

    // Right-click a file: paste into that file's directory (not the current one)
    await notes.click({ button: 'right' });
    await page.getByRole('button', { name: '粘贴', exact: true }).click();
    await expect.poll(async () => (await fsOps(page)).filter((op) => op.op === 'copy'))
      .toContainEqual({ op: 'copy', path: '/home/e2e/notes.txt', destDir: '/home/e2e' });

    // Right-click blank space: paste into the current directory
    // The right-side feedback occupies the bottom of this panel until it disappears.
    await page.mouse.move(0, 0);
    await expect(page.getByRole('status').filter({ hasText: /已复制/ })).toHaveCount(0);
    const box = await tree.boundingBox();
    await page.mouse.click(box!.x + 40, box!.y + box!.height - 20, { button: 'right' });
    await expect(page.getByRole('button', { name: '粘贴', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

    // Ctrl+V: paste into the current directory
    await notes.click();
    await page.keyboard.press('ControlOrMeta+v');
    await expect.poll(async () => (await fsOps(page)).filter((op) => op.op === 'copy'))
      .toContainEqual({ op: 'copy', path: '/home/e2e/notes.txt', destDir: '/home/e2e/project' });
  });

  test('consecutive deletes can be undone: the history stack supports multiple undo steps', async ({ page }) => {
    const tree = page.getByTestId('local-file-tree');
    const notes = tree.locator('[data-testid="file-row"][data-path="/home/e2e/notes.txt"]');
    const documents = tree.locator('[data-testid="file-row"][data-path="/home/e2e/Documents"]');

    // Delete twice in a row: the history stack keeps both steps
    await notes.click({ button: 'right' });
    await page.getByRole('button', { name: '删除', exact: true }).click();
    await page.locator('[data-testid="confirm-ok"]').click();
    await expect.poll(async () => (await fsOps(page)).filter((op) => op.op === 'delete'))
      .toContainEqual({ op: 'delete', path: '/home/e2e/notes.txt' });
    await documents.click({ button: 'right' });
    await page.getByRole('button', { name: '删除', exact: true }).click();
    await page.locator('[data-testid="confirm-ok"]').click();
    await expect.poll(async () => (await fsOps(page)).filter((op) => op.op === 'delete'))
      .toContainEqual({ op: 'delete', path: '/home/e2e/Documents' });

    // The more menu shows the remaining steps; undoing twice restores both
    await page.getByTestId('local-more-btn').click();
    await page.getByRole('button', { name: /^回退删除/ }).click();
    await expect.poll(async () => (await fsOps(page)).filter((op) => op.op === 'restore'))
      .toContainEqual({ op: 'restore', path: '/home/e2e/Documents' });
    await page.getByTestId('local-more-btn').click();
    await page.getByRole('button', { name: /^回退删除/ }).click();
    await expect.poll(async () => (await fsOps(page)).filter((op) => op.op === 'restore'))
      .toContainEqual({ op: 'restore', path: '/home/e2e/notes.txt' });
    // No undo entries remain once the stack is empty
    await page.getByTestId('local-more-btn').click();
    await expect(page.getByRole('button', { name: /^回退/ })).toHaveCount(0);
  });

  test('dragging a file onto a folder highlights it and moves the file', async ({ page }) => {
    const tree = page.getByTestId('local-file-tree');
    const notes = tree.locator('[data-testid="file-row"][data-path="/home/e2e/notes.txt"]');
    const documents = tree.locator('[data-testid="file-row"][data-path="/home/e2e/Documents"]');

    const from = await notes.boundingBox();
    const to = await documents.boundingBox();
    await page.mouse.move(from!.x + 40, from!.y + from!.height / 2);
    await page.mouse.down();
    await page.mouse.move(to!.x + 40, to!.y + to!.height / 2, { steps: 8 });
    // The drag preview shows the dragged file's icon instead of a text label
    await expect(page.getByTestId('file-drag-preview')).toBeVisible();
    await page.mouse.up();

    await expect.poll(async () => (await fsOps(page)).filter((op) => op.op === 'move'))
      .toContainEqual({ op: 'move', path: '/home/e2e/notes.txt', destDir: '/home/e2e/Documents' });
  });

  test('this PC view: drives appear as small cards with capacity, and clicking one enters it', async ({ page }) => {
    // Click the This PC breadcrumb to enter the drive view
    await page.getByText('此电脑').click();
    await expect(page.locator('[data-testid="disk-card-e2e-root"]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('[data-testid="disk-card-Backup"]')).toBeVisible();
    // The card shows capacity information (250 GB free)
    await expect(page.getByText('250 GB 可用')).toBeVisible();
    // Clicking a drive card enters that drive's root (the file list appears)
    await page.locator('[data-testid="disk-card-e2e-root"]').click();
    await expect(page.getByText('Documents')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('[data-testid="disk-card-e2e-root"]')).toHaveCount(0);
  });

  test('closing and reopening the panel', async ({ page }) => {
    // Close the panel by clicking the dock button again
    await page.locator('[data-dock-btn="files"]').click();
    await expect(page.getByText('Documents')).toBeHidden();
    // Reopen it
    await page.locator('[data-dock-btn="files"]').click();
    await expect(page.getByText('Documents')).toBeVisible({ timeout: 3000 });
  });

  test('dragging to the minimum width collapses immediately and dragging back before release cancels it', async ({ page }) => {
    await expect(page.getByText('Documents')).toBeVisible();
    // Drag the left edge right to reduce the auxiliary panel width.
    const handle = page.locator('[data-testid="resize-handle-files"]');
    await expect(handle).toBeVisible();
    const box = await handle.boundingBox();
    const cy = (box?.y ?? 0) + (box?.height ?? 0) / 2;
    const cx = (box?.x ?? 0) + (box?.width ?? 0) / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    // The 5th step (80px) reaches the lower limit -> collapse immediately (content hides but stays mounted, so state is kept), then stay collapsed
    for (let i = 0; i < 8; i++) {
      await page.mouse.move(cx + (i + 1) * 16, cy);
      await page.waitForTimeout(12);
      if (i >= 5) {
        await expect(page.getByText('Documents')).toBeHidden();
      }
    }
    // Drag left before releasing to restore the same mounted panel.
    for (let i = 0; i < 8; i++) {
      await page.mouse.move(cx + (8 - i) * 16, cy);
      await page.waitForTimeout(12);
    }
    await expect(page.getByText('Documents')).toBeVisible({ timeout: 3000 });
    // Release confirms it: the panel stays expanded
    await page.mouse.up();
    await expect(page.getByText('Documents')).toBeVisible();
    // Drag to collapse again and release right away -> it stays collapsed; the dock button restores it
    // (the width changed, so the handle moved and has to be located again)
    const box2 = await handle.boundingBox();
    const cx2 = (box2?.x ?? 0) + (box2?.width ?? 0) / 2;
    await page.mouse.move(cx2, cy);
    await page.mouse.down();
    for (let i = 0; i < 8; i++) {
      await page.mouse.move(cx2 + (i + 1) * 16, cy);
      await page.waitForTimeout(12);
    }
    await page.mouse.up();
    await expect(page.getByText('Documents')).toBeHidden();
    await page.locator('[data-dock-btn="files"]').click();
    await expect(page.getByText('Documents')).toBeVisible({ timeout: 3000 });
  });

  test('dragging back after a collapse keeps the panel state without reloading it', async ({ page }) => {
    // Enter a directory to change the panel's internal path state: double-click it
    const tree = page.getByTestId('local-file-tree');
    const documents = tree.locator('[data-testid="file-row"][data-path="/home/e2e/Documents"]');
    await documents.dblclick();
    await expect(tree).toHaveAttribute('data-path', '/home/e2e/Documents');
    // Drag to collapse without releasing
    const handle = page.locator('[data-testid="resize-handle-files"]');
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();
    const cy = (box!.y ?? 0) + (box!.height ?? 0) / 2;
    const cx = (box!.x ?? 0) + (box!.width ?? 0) / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 0; i < 8; i++) {
      await page.mouse.move(cx + (i + 1) * 16, cy);
      await page.waitForTimeout(12);
    }
    await expect(page.getByTestId('local-back-btn')).toBeHidden();
    // Drag back and release -> the panel returns and still shows the directory it entered (no state loss, no reload)
    for (let i = 0; i < 8; i++) {
      await page.mouse.move(cx + (8 - i) * 16, cy);
      await page.waitForTimeout(12);
    }
    await page.mouse.up();
    await expect(tree).toHaveAttribute('data-path', '/home/e2e/Documents');
    await expect(page.getByTestId('local-back-btn')).toBeVisible({ timeout: 3000 });
  });

  test('deleting a file asks for confirmation and then calls the backend delete (trash)', async ({ page }) => {
    await page.getByText('notes.txt').click({ button: 'right' });
    await page.getByRole('button', { name: '删除' }).click();
    await expect(page.locator('[data-testid="confirm-dialog"]')).toBeVisible();
    await expect(page.getByText('确认删除')).toBeVisible();
    await page.locator('[data-testid="confirm-ok"]').click();
    const ops = await fsOps(page);
    expect(ops).toContainEqual({ op: 'delete', path: '/home/e2e/notes.txt' });
  });

  test('renaming uses inline sidebar editing and confirms on Enter', async ({ page }) => {
    await page.getByText('notes.txt').click({ button: 'right' });
    await page.getByRole('button', { name: '重命名' }).click();
    // An inline input appears instead of a dialog
    const input = page.locator('[data-testid="rename-input"]');
    await expect(input).toBeVisible();
    await expect(page.locator('[data-testid="prompt-input"]')).toHaveCount(0);
    await input.fill('renamed.txt');
    await input.press('Enter');
    await expect(page.locator('[data-testid="confirm-dialog"]')).toBeVisible();
    await expect(page.getByText('确认重命名')).toBeVisible();
    await page.locator('[data-testid="confirm-ok"]').click();
    const ops = await fsOps(page);
    expect(ops).toContainEqual({ op: 'rename', path: '/home/e2e/notes.txt', newName: 'renamed.txt' });
  });

  test('the blank-area context menu and the ⋯ menu list the same actions', async ({ page }) => {
    const tree = page.getByTestId('local-file-tree');
    const menu = page.getByRole('menu', { name: '操作菜单' });
    const menuItems = () => menu.evaluate((el) => [...el.querySelectorAll('button')]
      .map((button) => (button as HTMLElement).innerText.trim()).filter(Boolean));

    await page.getByTestId('local-more-btn').click();
    const fromMore = await menuItems();
    await page.keyboard.press('Escape');
    expect(fromMore.length).toBeGreaterThan(0);

    const box = (await tree.boundingBox())!;
    await page.mouse.click(box.x + 40, box.y + box.height - 12, { button: 'right' });
    await expect(menu).toBeVisible();
    // Nothing is missing from the blank-area menu: it has every ⋯ entry and no extra Paste entry while the clipboard is empty
    expect(await menuItems()).toEqual(fromMore);
    await expect(menu.getByRole('button', { name: '下载管理', exact: true })).toBeVisible();
    await expect(menu.getByRole('button', { name: '收起全部文件夹', exact: true })).toBeVisible();
    await expect(menu.getByRole('button', { name: /^切换到当前终端文件目录/ })).toBeVisible();
  });

  test('refresh re-reads the current directory from both panel menus', async ({ page }) => {
    const tree = page.getByTestId('local-file-tree');
    const menu = page.getByRole('menu', { name: '操作菜单' });
    const externalRow = tree.locator('[data-testid="file-row"][data-path="/home/e2e/project/terminal.log"]');

    // A file created outside the panel only shows up on the next read.
    await page.evaluate(() => {
      (window as unknown as { __FS_EXTRA_ENTRIES__: { name: string; path: string; is_dir: boolean }[] }).__FS_EXTRA_ENTRIES__ =
        [{ name: 'terminal.log', path: '/home/e2e/project/terminal.log', is_dir: false }];
    });
    await expect(externalRow).toHaveCount(0);

    // ⋯ menu: re-read in place, without navigating away from the current directory.
    await page.getByTestId('local-more-btn').click();
    await menu.getByRole('button', { name: '刷新', exact: true }).click();
    await expect(externalRow).toBeVisible();
    await expect(tree).toHaveAttribute('data-path', '/home/e2e/project');

    // Blank-area right click: an entry removed outside disappears.
    await page.evaluate(() => { (window as unknown as { __FS_EXTRA_ENTRIES__: unknown[] }).__FS_EXTRA_ENTRIES__ = []; });
    await expect(externalRow).toBeVisible();
    const box = (await tree.boundingBox())!;
    await page.mouse.click(box.x + 40, box.y + box.height - 12, { button: 'right' });
    await menu.getByRole('button', { name: '刷新', exact: true }).click();
    await expect(externalRow).toHaveCount(0);
  });

  test('the context menu creates items in the directory under the click point, renames them immediately, auto-numbers duplicates and undoes with the real path', async ({ page }) => {
    const tree = page.getByTestId('local-file-tree');
    /** Right-click the blank area (locate by the element bounds so the click does not land on a row) */
    const rightClickBlank = async () => {
      const box = (await tree.boundingBox())!;
      await page.mouse.click(box.x + 40, box.y + box.height - 12, { button: 'right' });
    };
    // Right-click blank space -> the new folder lands in the current directory
    await rightClickBlank();
    await page.getByRole('button', { name: '新建文件夹', exact: true }).click();
    const input = page.locator('[data-testid="rename-input"]');
    await expect(input).toHaveValue('NewFolder');
    expect(await fsOps(page)).toContainEqual({ op: 'create-dir', path: '/home/e2e/project/NewFolder' });
    await input.press('Enter');   // Unchanged name: no rename request
    expect(await fsOps(page)).not.toContainEqual(expect.objectContaining({ op: 'rename' }));

    // Right-click a file row -> the new file lands beside that file
    await page.getByText('notes.txt').click({ button: 'right' });
    await page.getByRole('button', { name: '新建文件', exact: true }).click();
    await expect(input).toHaveValue('Untitled');
    expect(await fsOps(page)).toContainEqual({ op: 'create-file', path: '/home/e2e/Untitled' });

    // Rename to an existing name: the backend avoids it as notes (1).txt (the number goes before the extension), and the undo record must use the real path
    await input.fill('notes.txt');
    await input.press('Enter');
    await page.locator('[data-testid="confirm-ok"]').click();
    await expect(page.getByText('已重命名')).toBeVisible();

    await page.getByTestId('local-more-btn').click();
    await page.getByRole('button', { name: /回退重命名/ }).click();
    await expect(page.getByText('已回退重命名')).toBeVisible();
    expect(await fsOps(page)).toContainEqual({ op: 'rename', path: '/home/e2e/notes (1).txt', newName: 'Untitled' });
  });

  test('new files and pastes can both be undone (undo create / undo paste)', async ({ page }) => {
    const tree = page.getByTestId('local-file-tree');
    const box = (await tree.boundingBox())!;
    // Create a file -> the more menu shows Undo create
    await page.mouse.click(box.x + 40, box.y + box.height - 12, { button: 'right' });
    await page.getByRole('button', { name: '新建文件', exact: true }).click();
    await page.locator('[data-testid="rename-input"]').press('Escape');
    await page.getByTestId('local-more-btn').click();
    await page.getByRole('button', { name: /回退新建/ }).click();
    await expect(page.getByText('已回退新建')).toBeVisible();
    expect(await fsOps(page)).toContainEqual({ op: 'delete', path: '/home/e2e/project/Untitled' });

    // Copy a file into its own directory -> undo paste removes the copied entry
    await page.getByText('notes.txt').first().click({ button: 'right' });
    await page.getByRole('button', { name: '复制', exact: true }).click();
    await page.mouse.click(box.x + 40, box.y + box.height - 12, { button: 'right' });
    await page.getByRole('button', { name: '粘贴', exact: true }).click();
    await expect(page.getByText('已复制 1 项（同名已自动加序号）')).toBeVisible();
    await page.getByTestId('local-more-btn').click();
    await page.getByRole('button', { name: /回退粘贴/ }).click();
    await expect(page.getByText('已回退粘贴')).toBeVisible();
    expect(await fsOps(page)).toContainEqual({ op: 'delete', path: '/home/e2e/project/notes (1).txt' });
  });

  test('creating a file from a folder context menu: it lands inside the folder, is renamed immediately and appears in the child list after submitting', async ({ page }) => {
    await page.getByText('Documents').first().click({ button: 'right' });
    await page.getByRole('button', { name: '新建文件', exact: true }).click();
    const input = page.locator('[data-testid="rename-input"]');
    await expect(input).toHaveValue('Untitled');
    expect(await fsOps(page)).toContainEqual({ op: 'create-file', path: '/home/e2e/Documents/Untitled' });

    await input.fill('plan.md');
    await input.press('Enter');
    await page.locator('[data-testid="confirm-ok"]').click();
    await expect(page.getByText('已重命名')).toBeVisible();
    expect(await fsOps(page)).toContainEqual({ op: 'rename', path: '/home/e2e/Documents/Untitled', newName: 'plan.md' });
    // The target folder expands automatically and the new entry appears in its child list (the mock lists new entries in several places, so take the first)
    await expect(page.locator('[data-testid="file-row"][data-path="/home/e2e/Documents/Untitled"]').first()).toBeVisible();
  });

  test('the backend avoids duplicate names with a number and the item still enters rename immediately', async ({ page }) => {
    const input = page.locator('[data-testid="rename-input"]');

    // Create the default name first and press Escape to cancel renaming (the entry stays in the directory)
    await page.getByTestId('local-more-btn').click();
    await page.getByRole('button', { name: '新建文件', exact: true }).click();
    await expect(input).toHaveValue('Untitled');
    await input.press('Escape');

    // Create the same name again -> the backend avoids it as Untitled (1) and renaming still starts immediately
    await page.getByTestId('local-more-btn').click();
    await page.getByRole('button', { name: '新建文件', exact: true }).click();
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('Untitled (1)');
  });

  test('both the row context menu and the more menu can reveal items in the system file manager', async ({ page }) => {
    const tree = page.getByTestId('local-file-tree');
    const notes = tree.locator('[data-testid="file-row"][data-path="/home/e2e/notes.txt"]');

    // Row context menu: reveal that entry
    await notes.click({ button: 'right' });
    await page.getByRole('button', { name: '在文件管理器中显示' }).click();
    await expect.poll(() => revealedPaths(page)).toContain('/home/e2e/notes.txt');

    // ⋯ menu: reveal the current folder
    const currentDir = await tree.getAttribute('data-path');
    await page.getByTestId('local-more-btn').click();
    await page.getByRole('button', { name: '在文件管理器中显示当前文件夹' }).click();
    await expect.poll(() => revealedPaths(page)).toContain(currentDir);
  });

  test('the more menu can create files and folders directly in the current folder', async ({ page }) => {
    const input = page.locator('[data-testid="rename-input"]');

    await page.getByTestId('local-more-btn').click();
    await page.getByRole('button', { name: '新建文件夹', exact: true }).click();
    await expect(input).toHaveValue('NewFolder');
    expect(await fsOps(page)).toContainEqual({ op: 'create-dir', path: '/home/e2e/project/NewFolder' });
    await input.press('Escape');

    await page.getByTestId('local-more-btn').click();
    await page.getByRole('button', { name: '新建文件', exact: true }).click();
    await expect(input).toHaveValue('Untitled');
    expect(await fsOps(page)).toContainEqual({ op: 'create-file', path: '/home/e2e/project/Untitled' });
    await input.press('Escape');
  });

  test('copying a file into its own directory auto-numbers it and says so in the notification', async ({ page }) => {
    await page.getByText('notes.txt').first().click({ button: 'right' });
    await page.getByRole('button', { name: '复制', exact: true }).click();
    const tree = page.getByTestId('local-file-tree');
    const box = (await tree.boundingBox())!;
    await page.mouse.click(box.x + 40, box.y + box.height - 12, { button: 'right' });
    await page.getByRole('button', { name: '粘贴', exact: true }).click();
    await expect(page.getByText('已复制 1 项（同名已自动加序号）')).toBeVisible();
    expect(await fsOps(page)).toContainEqual({ op: 'copy', path: '/home/e2e/notes.txt', destDir: '/home/e2e/project' });
  });

  test('the local panel menu has no remote-only entries', async ({ page }) => {
    await page.getByText('Documents').first().click({ button: 'right' });
    await expect(page.getByRole('button', { name: '在新标签页中打开' })).toBeVisible();
    await expect(page.getByRole('button', { name: /下载.*到本地/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '上传文件', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.getByTestId('local-more-btn').click();
    await expect(page.getByRole('button', { name: '从当前文件夹新建标签页' })).toBeVisible();
    await expect(page.getByRole('button', { name: '下载管理' })).toBeVisible();
    await expect(page.getByRole('button', { name: '上传文件', exact: true })).toHaveCount(0);
  });
});
