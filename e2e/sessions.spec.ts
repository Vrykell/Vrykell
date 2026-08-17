import { test, expect } from '@playwright/test';
import { setupTauriMock, ptyWrites } from './tauri-mock';

async function openHistory(page: import('@playwright/test').Page) {
  await page.locator('[data-dock-btn="tabs"]').click();
  await page.locator('[data-testid="tab-history-btn"]').click();
}

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
});

test.describe('会话历史管理', () => {
  test('历史会话可删除', async ({ page }) => {
    await openHistory(page);
    await expect(page.getByText('旧的调试会话')).toBeVisible();
    await page.locator('[data-testid="session-delete-hist-1"]').click();
    await expect(page.getByText('旧的调试会话')).toHaveCount(0);
    await expect(page.getByText('暂无历史会话')).toBeVisible();
  });

  test('恢复历史会话连带恢复命令块', async ({ page }) => {
    await openHistory(page);
    // 点击历史会话恢复
    await page.getByText('旧的调试会话').click();
    // 新标签页标题为会话标题，命令块输出恢复出来
    await expect(page.getByText('total 1')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid^="tab-row-"]', { hasText: '旧的调试会话' })).toHaveCount(1);
  });
});

test.describe('文件双击打开', () => {
  test('双击文件默认新建标签页并用终端编辑器打开', async ({ page }) => {
    await page.locator('[data-dock-btn="files"]').click();
    await expect(page.getByText('notes.txt')).toBeVisible();
    await page.getByText('notes.txt').dblclick();
    // 新建标签页（标题为文件名）
    await page.locator('[data-dock-btn="tabs"]').click();
    await expect(page.locator('[data-testid^="tab-row-"]', { hasText: 'notes.txt' })).toHaveCount(1);
    // 编辑器命令写入 PTY
    await expect.poll(() => ptyWrites(page)).toContain('vim /home/e2e/notes.txt\n');
  });
});
