import { test, expect } from '@playwright/test';
import { setupTauriMock, revealedPaths, sshOps, ensureTabsOpen } from './tauri-mock';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  // 打开 SSH 管理面板
  await page.locator('[data-dock-btn="ssh"]').click();
  await expect(page.locator('[data-testid="ssh-search"]')).toBeVisible();
});

test.describe('SSH 远程连接管理侧栏', () => {
  test('Enter on an edit button opens the form without connecting', async ({ page }) => {
    await page.getByTestId('ssh-row-ssh-1').click();
    const edit = page.getByRole('button', { name: '编辑「生产服务器」', exact: true }).last();
    await edit.focus();
    await edit.press('Enter');
    await expect(page.getByTestId('ssh-form-name')).toHaveValue('生产服务器');
    const spawns = await page.evaluate(() => (window as unknown as Record<string, { ssh?: unknown }[]>).__PTY_SPAWNS__);
    expect(spawns.filter(s => s.ssh)).toHaveLength(0);
  });
  test('SSH rows match the current session tab style', async ({ page }) => {
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
    await expect(row).toHaveAttribute('title', /root@prod.example.com:22/);
    await ensureTabsOpen(page);
    expect(await rowStyle('[data-tab-row-id]')).toEqual(sshStyle);
  });
  test('顶栏：搜索 + 编辑 + 新建按钮', async ({ page }) => {
    await expect(page.locator('[data-testid="ssh-search"]')).toBeVisible();
    await expect(page.locator('[data-testid="ssh-edit-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="ssh-new-btn"]')).toBeVisible();
  });

  test('展示已有连接并支持按名字搜索', async ({ page }) => {
    await expect(page.getByText('生产服务器')).toBeVisible();
    await page.locator('[data-testid="ssh-search"]').fill('不存在的');
    await expect(page.getByText('无匹配连接')).toBeVisible();
    await page.locator('[data-testid="ssh-search"]').fill('生产');
    await expect(page.getByText('生产服务器')).toBeVisible();
  });

  test('双击连接新建活跃会话标签页，按需打开文件面板', async ({ page }) => {
    await page.getByText('生产服务器').dblclick();
    await page.locator('[data-dock-btn="files"]').click();
    // Open the optional file service separately from the terminal session.
    await expect(page.getByText('app.log')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Documents')).toBeVisible();
    // 标签面板出现以连接名命名的标签页
    await ensureTabsOpen(page);
    await expect(page.locator('[data-testid^="tab-row-"]', { hasText: '生产服务器' })).toHaveCount(1);
  });

  test('新建连接：填写表单并保存', async ({ page }) => {
    await page.locator('[data-testid="ssh-new-btn"]').click();
    await page.locator('[data-testid="ssh-form-name"]').fill('测试机');
    await page.locator('[data-testid="ssh-form-host"]').fill('staging.example.com');
    await page.locator('[data-testid="ssh-form-user"]').fill('deploy');
    await page.locator('[data-testid="ssh-save-btn"]').click();
    await expect(page.getByText('测试机')).toBeVisible();
  });

  test('编辑选中连接并删除', async ({ page }) => {
    await page.getByText('生产服务器').click(); // 选中
    await page.locator('[data-testid="ssh-edit-btn"]').click();
    await expect(page.locator('[data-testid="ssh-form-name"]')).toHaveValue('生产服务器');
    await page.locator('[data-testid="ssh-delete-btn"]').click();
    await expect(page.getByText(/暂无 SSH 连接/)).toBeVisible();
  });

  test('测试连接：成功与失败提示', async ({ page }) => {
    await page.locator('[data-testid="ssh-new-btn"]').click();
    await page.locator('[data-testid="ssh-form-host"]').fill('bad.example.com');
    await page.locator('[data-testid="ssh-test-btn"]').click();
    await expect(page.locator('[data-testid="ssh-test-result"]')).toContainText('连接超时');
    await page.locator('[data-testid="ssh-form-host"]').fill('good.example.com');
    await page.locator('[data-testid="ssh-test-btn"]').click();
    await expect(page.locator('[data-testid="ssh-test-result"]')).toContainText('连接成功');
  });

  test('远程目录可下载，下载管理可定位到文件管理器', async ({ page }) => {
    await page.getByText('生产服务器').dblclick();
    await page.locator('[data-dock-btn="files"]').click();
    await expect(page.locator('[data-testid="remote-file-Documents"]')).toBeVisible({ timeout: 5000 });
    // 右键远程目录 → 下载文件夹到本地
    await page.locator('[data-testid="remote-file-Documents"]').click({ button: 'right' });
    await page.getByRole('button', { name: '下载文件夹到本地' }).click();
    await expect(page.getByText(/已下载到/)).toBeVisible();
    // 进入下载管理（⋯ 菜单）
    await page.locator('[data-testid="remote-more-btn"]').click();
    await page.getByRole('button', { name: '下载管理' }).click();
    await expect(page.getByText('下载管理')).toBeVisible();
    await expect(page.locator('[data-testid="download-item-Documents"]')).toBeVisible();
    // 定位到系统文件管理器
    await page.locator('[data-testid="download-reveal-Documents"]').click();
    expect(await revealedPaths(page)).toContain('/tmp/Documents');
  });

  test('远程面板：单击选中、Ctrl 加选、双击进入、回退还原视图与选中', async ({ page }) => {
    await page.getByText('生产服务器').dblclick();
    await page.locator('[data-dock-btn="files"]').click();
    const tree = page.locator('[data-testid="remote-file-tree"]');
    const folder = page.locator('[data-testid="remote-file-Documents"]');
    await expect(folder).toBeVisible({ timeout: 5000 });

    // 单击只选中，不进入目录
    await folder.click();
    await expect(folder).toHaveAttribute('data-selected', 'true');
    await expect(tree).toHaveAttribute('data-path', '/home/root');

    // Ctrl 点击加选文件行
    await page.locator('[data-testid="remote-file-app.log"]').click({ modifiers: ['Control'] });
    await expect(page.locator('[data-testid="remote-file-app.log"]')).toHaveAttribute('data-selected', 'true');

    // 路径编辑跳转到上层目录
    await page.locator('[data-testid="remote-crumb-bar"]').click();
    const input = page.locator('[data-testid="remote-path-input"]');
    await input.fill('/home');
    await input.press('Enter');
    await expect(tree).toHaveAttribute('data-path', '/home');

    // 回退 = 上一个视图快照：路径与多选都还原
    await page.locator('[data-testid="remote-back-btn"]').click();
    await expect(tree).toHaveAttribute('data-path', '/home/root');
    await expect(page.locator('[data-testid="remote-file-Documents"]')).toHaveAttribute('data-selected', 'true');
    await expect(page.locator('[data-testid="remote-file-app.log"]')).toHaveAttribute('data-selected', 'true');

    // 键盘 Enter 进入当前锚点目录
    await folder.click();
    await tree.focus();
    await page.keyboard.press('Enter');
    await expect(tree).toHaveAttribute('data-path', '/home/root/Documents');

    // 双击同样进入目录
    await page.locator('[data-testid="remote-back-btn"]').click();
    await expect(tree).toHaveAttribute('data-path', '/home/root');
    await folder.dblclick();
    await expect(tree).toHaveAttribute('data-path', '/home/root/Documents');
  });

  test('远程面板：面包屑可编辑跳转，删除可从更多菜单回退', async ({ page }) => {
    await page.getByText('生产服务器').dblclick();
    await page.locator('[data-dock-btn="files"]').click();
    const tree = page.locator('[data-testid="remote-file-tree"]');
    await expect(page.locator('[data-testid="remote-file-app.log"]')).toBeVisible({ timeout: 5000 });

    // 面包屑 → 编辑路径，回车跳转
    await page.locator('[data-testid="remote-crumb-bar"]').click();
    const input = page.locator('[data-testid="remote-path-input"]');
    await expect(input).toBeVisible();
    await input.fill('/var/log');
    await input.press('Enter');
    await expect(tree).toHaveAttribute('data-path', '/var/log');

    // 删除 = 移到远端暂存，可从更多菜单回退
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
});
