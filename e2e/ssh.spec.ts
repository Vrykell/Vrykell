import { test, expect } from '@playwright/test';
import { setupTauriMock, revealedPaths, ensureTabsOpen } from './tauri-mock';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  // 打开 SSH 管理面板
  await page.locator('[data-dock-btn="ssh"]').click();
  await expect(page.locator('[data-testid="ssh-search"]')).toBeVisible();
});

test.describe('SSH 远程连接管理侧栏', () => {
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

  test('双击连接新建活跃会话标签页，文件面板自动连到远程', async ({ page }) => {
    await page.getByText('生产服务器').dblclick();
    // 文件面板自动打开并连到远程（mock ssh_list 返回远程条目）
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
});
