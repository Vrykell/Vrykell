import { test, expect } from '@playwright/test';
import { setupTauriMock, revealedPaths, sshOps, ensureTabsOpen } from './tauri-mock';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  // Open the SSH management panel
  await page.locator('[data-dock-btn="ssh"]').click();
  await expect(page.locator('[data-testid="ssh-search"]')).toBeVisible();
});

test.describe('SSH remote connection management sidebar', () => {
  test('Enter on an edit button opens the form without connecting', async ({ page }) => {
    await page.getByTestId('ssh-row-ssh-1').press('Shift+F10');
    const edit = page.getByRole('button', { name: '编辑连接', exact: true });
    await edit.focus();
    await edit.press('Enter');
    await expect(page.getByTestId('ssh-form-name')).toHaveValue('生产服务器');
    const spawns = await page.evaluate(() => (window as unknown as Record<string, { ssh?: unknown }[]>).__PTY_SPAWNS__);
    expect(spawns.filter(s => s.ssh)).toHaveLength(0);
  });
  test('SSH resources retain shared sidebar rows while terminal instances use horizontal tabs', async ({ page }) => {
    const row = page.getByTestId('ssh-row-ssh-1');
    await row.click();
    const selectionColor = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.backgroundColor = 'var(--selection-bg)';
      document.body.appendChild(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    });
    await expect(row.locator(':scope > div')).toHaveCSS('background-color', selectionColor);
    const rowStyle = async (selector: string) => page.locator(selector).evaluate(el => {
      const inner = el.firstElementChild!;
      const style = getComputedStyle(inner);
      return { outerPadding: getComputedStyle(el).padding, padding: style.padding, radius: style.borderRadius, height: inner.getBoundingClientRect().height, background: style.backgroundColor, gap: style.gap, icon: inner.querySelector('svg')?.getBoundingClientRect().width };
    });
    const sshStyle = await rowStyle('[data-testid="ssh-row-ssh-1"]');
    expect(sshStyle).toMatchObject({ outerPadding: '0px', padding: '6px 14px', radius: '8px', gap: '12px', icon: 20 });
    await expect(row).toHaveAttribute('data-tip', /root@prod.example.com:22/);
    await ensureTabsOpen(page);
    await expect(page.locator('[data-tab-row-id]').first()).toHaveClass(/folder-tab/);
    await expect(page.locator('[data-tab-row-id] [role="tab"] svg').first()).toHaveCSS('width', '18px');
  });
  test('top bar: search, edit and new-connection buttons', async ({ page }) => {
    await expect(page.locator('[data-testid="ssh-search"]')).toBeVisible();
    await page.getByTestId('ssh-row-ssh-1').click({ button: 'right' }); await expect(page.getByRole('button', { name: '编辑连接', exact: true })).toBeVisible();
    await expect(page.locator('[data-testid="ssh-new-btn"]')).toBeVisible();
  });

  test('lists existing connections and searches them by name', async ({ page }) => {
    await expect(page.getByText('生产服务器')).toBeVisible();
    await page.locator('[data-testid="ssh-search"]').fill('不存在的');
    await expect(page.getByText('无匹配连接')).toBeVisible();
    await page.locator('[data-testid="ssh-search"]').fill('生产');
    await expect(page.getByText('生产服务器')).toBeVisible();
  });

  test('double-clicking a connection opens an active session tab and the file panel on demand', async ({ page }) => {
    await page.getByText('生产服务器').dblclick();
    await page.locator('[data-dock-btn="files"]').click();
    // Open the optional file service separately from the terminal session.
    await expect(page.getByText('app.log')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Documents')).toBeVisible();
    // The tab strip shows a tab named after the connection
    await ensureTabsOpen(page);
    await expect(page.locator('[data-testid^="tab-row-"]', { hasText: '生产服务器' })).toHaveCount(1);
  });

  test('new connection: fills in and saves the form', async ({ page }) => {
    await page.locator('[data-testid="ssh-new-btn"]').click();
    await page.locator('[data-testid="ssh-form-name"]').fill('测试机');
    await page.locator('[data-testid="ssh-form-host"]').fill('staging.example.com');
    await page.locator('[data-testid="ssh-form-user"]').fill('deploy');
    await page.locator('[data-testid="ssh-save-btn"]').click();
    await expect(page.getByText('测试机')).toBeVisible();
  });

  test('edits and deletes the selected connection', async ({ page }) => {
    await page.getByText('生产服务器').click(); // select the connection
    await page.getByTestId('ssh-row-ssh-1').click({ button: 'right' }); await page.getByRole('button', { name: '编辑连接', exact: true }).click();
    await expect(page.locator('[data-testid="ssh-form-name"]')).toHaveValue('生产服务器');
    await page.locator('[data-testid="ssh-delete-btn"]').click();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByText(/暂无 SSH 连接/)).toBeVisible();
  });

  test('tests a connection: success and failure feedback', async ({ page }) => {
    await page.locator('[data-testid="ssh-new-btn"]').click();
    await page.locator('[data-testid="ssh-form-host"]').fill('bad.example.com');
    await page.locator('[data-testid="ssh-test-btn"]').click();
    await expect(page.locator('[data-testid="ssh-test-result"]')).toContainText('连接超时');
    await page.locator('[data-testid="ssh-form-host"]').fill('good.example.com');
    await page.locator('[data-testid="ssh-test-btn"]').click();
    await expect(page.locator('[data-testid="ssh-test-result"]')).toContainText('认证成功');
  });

  test('downloads remote directories and reveals transfers in the file manager', async ({ page }) => {
    await page.getByText('生产服务器').dblclick();
    await page.locator('[data-dock-btn="files"]').click();
    await expect(page.locator('[data-testid="remote-file-Documents"]')).toBeVisible({ timeout: 5000 });
    // The overflow menu opens download management directly; going back returns to file browsing
    await page.locator('[data-testid="remote-more-btn"]').click();
    await page.getByRole('button', { name: '下载管理' }).click();
    await expect(page.getByText('暂无传输记录')).toBeVisible();
    await page.getByTestId('downloads-back').click();
    // Right-click a remote directory, then download the folder locally; the panel switches to download management once the transfer starts
    await page.locator('[data-testid="remote-file-Documents"]').click({ button: 'right' });
    await page.getByRole('button', { name: '下载文件夹到本地' }).click();
    await expect(page.getByText(/已下载到/)).toBeVisible();
    await expect(page.getByText('下载管理')).toBeVisible();
    await expect(page.locator('[data-testid="download-item-Documents"]')).toBeVisible();
    // Reveal in the system file manager (row actions appear on hover)
    await page.locator('[data-testid="download-item-Documents"]').hover();
    await page.locator('[data-testid="download-reveal-Documents"]').click();
    expect(await revealedPaths(page)).toContain('/tmp/Documents');
  });

  test('remote panel: the properties context menu shows remote metadata without a creation time', async ({ page }) => {
    await page.getByText('生产服务器').dblclick();
    await page.locator('[data-dock-btn="files"]').click();
    await expect(page.locator('[data-testid="remote-file-app.log"]')).toBeVisible({ timeout: 5000 });

    await page.locator('[data-testid="remote-file-app.log"]').click({ button: 'right' });
    await page.getByRole('button', { name: '属性', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: '属性' });
    await expect(page.getByTestId('file-property-name')).toHaveText('app.log');
    await expect(page.getByTestId('file-property-type')).toHaveText('LOG 文件');
    await expect(page.getByTestId('file-property-location')).toHaveText('/home/root');
    await expect(page.getByTestId('file-property-size')).toHaveText('2.0 KB');
    // SFTP provides no creation time: the row is not rendered
    await expect(page.getByTestId('file-property-created')).toHaveCount(0);

    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('remote panel: click selects, Ctrl-click adds to the selection, double-click enters a folder and back restores the view and selection', async ({ page }) => {
    await page.getByText('生产服务器').dblclick();
    await page.locator('[data-dock-btn="files"]').click();
    const tree = page.locator('[data-testid="remote-file-tree"]');
    const folder = page.locator('[data-testid="remote-file-Documents"]');
    await expect(folder).toBeVisible({ timeout: 5000 });

    // A single click only selects; it does not enter the folder
    await folder.click();
    await expect(folder).toHaveAttribute('data-selected', 'true');
    await expect(tree).toHaveAttribute('data-path', '/home/root');

    // Ctrl-click adds the file row to the selection
    await page.locator('[data-testid="remote-file-app.log"]').click({ modifiers: ['Control'] });
    await expect(page.locator('[data-testid="remote-file-app.log"]')).toHaveAttribute('data-selected', 'true');

    // Editing the path navigates to the parent directory
    await page.locator('[data-testid="remote-crumb-bar"]').click();
    const input = page.locator('[data-testid="remote-path-input"]');
    await input.fill('/home');
    await input.press('Enter');
    await expect(tree).toHaveAttribute('data-path', '/home');

    // Back restores the previous view snapshot, including the path and multi-selection
    await page.locator('[data-testid="remote-back-btn"]').click();
    await expect(tree).toHaveAttribute('data-path', '/home/root');
    await expect(page.locator('[data-testid="remote-file-Documents"]')).toHaveAttribute('data-selected', 'true');
    await expect(page.locator('[data-testid="remote-file-app.log"]')).toHaveAttribute('data-selected', 'true');

    // Enter opens the focused anchor directory
    await folder.click();
    await tree.focus();
    await page.keyboard.press('Enter');
    await expect(tree).toHaveAttribute('data-path', '/home/root/Documents');

    // Double-click also enters the folder
    await page.locator('[data-testid="remote-back-btn"]').click();
    await expect(tree).toHaveAttribute('data-path', '/home/root');
    await folder.dblclick();
    await expect(tree).toHaveAttribute('data-path', '/home/root/Documents');
  });

  test('remote panel: the breadcrumb is editable and a deletion can be reverted from the more menu', async ({ page }) => {
    await page.getByText('生产服务器').dblclick();
    await page.locator('[data-dock-btn="files"]').click();
    const tree = page.locator('[data-testid="remote-file-tree"]');
    await expect(page.locator('[data-testid="remote-file-app.log"]')).toBeVisible({ timeout: 5000 });

    // Clicking the breadcrumb edits the path; Enter navigates
    await page.locator('[data-testid="remote-crumb-bar"]').click();
    const input = page.locator('[data-testid="remote-path-input"]');
    await expect(input).toBeVisible();
    await input.fill('/var/log');
    await input.press('Enter');
    await expect(tree).toHaveAttribute('data-path', '/var/log');

    // Deleting moves the entry to a remote staging area and the more menu can restore it
    await page.locator('[data-testid="remote-file-app.log"]').click({ button: 'right' });
    await page.getByRole('button', { name: '删除', exact: true }).click();
    await page.locator('[data-testid="confirm-ok"]').click();
    await expect(page.getByText(/可在更多菜单回退/)).toBeVisible();
    expect(await sshOps(page)).toEqual(expect.arrayContaining([{ op: 'delete', path: '/var/log/app.log' }]));

    await page.locator('[data-testid="remote-more-btn"]').click();
    await page.getByRole('button', { name: /回退删除/ }).click();
    await expect(page.getByText(/已回退删除/)).toBeVisible();
    expect(await sshOps(page)).toEqual(expect.arrayContaining([{ op: 'restore', path: '/var/log/app.log' }]));
  });

  test('remote panel: context-menu creation targets the click location, name clashes are avoided and a revert uses the real path', async ({ page }) => {
    await page.getByText('生产服务器').dblclick();
    await page.locator('[data-dock-btn="files"]').click();
    const tree = page.locator('[data-testid="remote-file-tree"]');
    await expect(page.locator('[data-testid="remote-file-app.log"]')).toBeVisible({ timeout: 5000 });

    // Right-click a folder: the new file lands inside it and its rename starts immediately
    await page.locator('[data-testid="remote-file-Documents"]').click({ button: 'right' });
    await page.getByRole('button', { name: '新建文件', exact: true }).click();
    const input = page.locator('[data-testid="rename-input"]');
    await expect(input).toHaveValue('Untitled');
    expect(await sshOps(page)).toEqual(expect.arrayContaining([{ op: 'create-file', path: '/home/root/Documents/Untitled' }]));
    await input.press('Escape');

    // Right-click empty space: the new folder lands in the current directory
    const box = (await tree.boundingBox())!;
    await page.mouse.click(box.x + 40, box.y + box.height - 12, { button: 'right' });
    await page.getByRole('button', { name: '新建文件夹', exact: true }).click();
    expect(await sshOps(page)).toEqual(expect.arrayContaining([{ op: 'create-dir', path: '/home/root/NewFolder' }]));
    await page.locator('[data-testid="rename-input"]').press('Escape');

    // Drag app.log into Documents with a name clash: the backend returns a numbered path and the revert moves it back by real path
    const source = page.locator('[data-testid="remote-file-app.log"][data-path="/home/root/app.log"]');
    const targetRow = page.locator('[data-testid="remote-file-Documents"][data-path="/home/root/Documents"]');
    const from = (await source.boundingBox())!;
    await page.mouse.move(from.x + 40, from.y + from.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      const box = await targetRow.boundingBox();
      await page.mouse.move(from.x + 40 + ((box!.x + 40) - (from.x + 40)) * (i / 6), from.y + from.height / 2 + ((box!.y + box!.height / 2) - (from.y + from.height / 2)) * (i / 6));
      await page.waitForTimeout(12);
    }
    await page.mouse.up();
    await page.locator('[data-testid="remote-more-btn"]').click();
    await page.getByRole('button', { name: /回退移动/ }).click();
    await expect(page.getByText('已回退移动')).toBeVisible();
    expect(await sshOps(page)).toEqual(expect.arrayContaining([{ op: 'move', path: '/home/root/Documents/app (1).log', destDir: '/home/root' }]));
  });

  test('remote panel: clicking the root breadcrumb returns to the root instead of resolving the home directory again', async ({ page }) => {
    await page.getByText('生产服务器').dblclick();
    await page.locator('[data-dock-btn="files"]').click();
    const tree = page.locator('[data-testid="remote-file-tree"]');
    await expect(page.locator('[data-testid="remote-file-app.log"]').first()).toBeVisible({ timeout: 5000 });
    await expect(tree).toHaveAttribute('data-path', '/home/root');

    await page.locator('[data-testid="remote-crumb-bar"]').getByText('/', { exact: true }).click();
    await expect(tree).toHaveAttribute('data-path', '/');
    // Wait a beat: confirm the unresolved-to-home fallback does not send it back to /home/root
    await page.waitForTimeout(300);
    await expect(tree).toHaveAttribute('data-path', '/');
  });

  test('remote panel: the expander lazy-loads children and menus list only remote-capable actions', async ({ page }) => {
    await page.getByText('生产服务器').dblclick();
    await page.locator('[data-dock-btn="files"]').click();
    const folder = page.locator('[data-testid="remote-file-Documents"][data-path="/home/root/Documents"]');
    await expect(folder).toBeVisible({ timeout: 5000 });

    // The expander, not a single row click, lazy-loads the children
    await folder.locator('[data-testid="remote-row-expander"]').click();
    await expect(page.locator('[data-testid="remote-file-app.log"][data-path="/home/root/Documents/app.log"]').first()).toBeVisible();

    // Row menu: downloads are available, local-only entries such as workspace and terminal editor are not
    await folder.click({ button: 'right' });
    await expect(page.getByRole('button', { name: /下载文件夹到本地/ })).toBeVisible();
    await expect(page.getByRole('button', { name: '添加到工作区' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '使用终端编辑器打开' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Overflow menu: upload and download management are available, the local-only new tab is not
    await page.locator('[data-testid="remote-more-btn"]').click();
    await expect(page.getByRole('button', { name: '上传文件', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '上传文件夹', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '下载管理' })).toBeVisible();
    await expect(page.getByRole('button', { name: '从当前文件夹新建标签页' })).toHaveCount(0);
  });
});
