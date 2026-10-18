import { test, expect } from '@playwright/test';
import { setupTauriMock, ptyWrites, ensureTabsOpen } from './tauri-mock';

async function openHistory(page: import('@playwright/test').Page) {
  await ensureTabsOpen(page);
  await page.locator('[data-testid="tab-history-btn"]').click();
}

test.beforeEach(async ({ page }, testInfo) => {
  await setupTauriMock(page, { groupedHistoricalSession: testInfo.title === 'restoring one session from an archived group keeps it visible in the tab list' });
  await page.goto('/');
});

test.describe('会话历史管理', () => {
  test('启动时自动恢复上次活跃会话', async ({ page }) => {
    // mock list_sessions 返回 status=active 的 t1 → 启动后自动恢复为标签
    // （恢复的标签 id 为 t1，区别于模块级默认标签）
    await ensureTabsOpen(page);
    await expect(page.locator('[data-testid="tab-row-t1"]')).toBeVisible({ timeout: 5000 });
  });

  test('筛选：搜索框 + 筛选菜单过滤会话，状态同会话内记忆', async ({ page }) => {
    await openHistory(page);
    await expect(page.getByText('旧的调试会话')).toBeVisible();
    // 搜索过滤
    await page.locator('[data-testid="session-filter-input"]').fill('不存在的会话');
    await expect(page.getByText('旧的调试会话')).toHaveCount(0);
    await page.locator('[data-testid="session-filter-input"]').fill('');
    await expect(page.getByText('旧的调试会话')).toBeVisible();
    // 筛选菜单：选 SSH（历史会话是 local → 消失）
    await page.locator('[data-testid="session-filter-btn"]').click();
    const menu = page.locator('[data-testid="session-filter-menu"]');
    await menu.getByRole('button', { name: 'SSH' }).click();
    await expect(page.getByText('旧的调试会话')).toHaveCount(0);
    // Filter choices stay open until dismissed or their trigger is toggled.
    await page.locator('[data-testid="session-filter-menu"]').getByRole('button', { name: '全部' }).first().click();
    await expect(page.getByText('旧的调试会话')).toBeVisible();
    // The selected filters survive a reload in the same application session.
    await page.locator('[data-testid="session-filter-menu"]').getByRole('button', { name: 'SSH' }).click();
    await page.reload();
    // 幂等打开会话历史页（面板状态可能已被持久化，避免 toggle 关掉它）
    await expect(page.locator('[data-testid^="tab-row-"]').first()).toBeVisible();
    if (!(await page.locator('[data-testid="tab-history-btn"]').isVisible().catch(() => false))) {
      await ensureTabsOpen(page);
    }
    await expect(page.locator('[data-testid="tab-history-btn"]')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="tab-history-btn"]').click();
    await expect(page.getByText('旧的调试会话')).toHaveCount(0);
  });

  test('历史会话可删除', async ({ page }) => {
    await openHistory(page);
    await expect(page.getByText('旧的调试会话')).toBeVisible();
    const record = page.getByTestId('history-session-hist-1');
    const remove = page.getByTestId('session-menu-hist-1');
    const quickActions = record.locator('.history-row-quick-actions');
    await expect(remove).toHaveCSS('opacity', '0');
    await expect(quickActions).toHaveCSS('opacity', '0');
    await record.focus();
    await expect(remove).toHaveCSS('opacity', '1');
    await expect(quickActions).toHaveCSS('opacity', '1');
    await remove.click();
    await page.getByRole('menuitem', { name: '删除此会话', exact: true }).click();
    await expect(page.getByText('旧的调试会话')).toHaveCount(0);
    await expect(page.getByText('暂无历史会话')).toBeVisible();
  });

  test('恢复历史会话连带恢复命令块', async ({ page }) => {
    await openHistory(page);
    // 点击历史会话恢复
    await page.getByText('旧的调试会话').click();
    // 新标签页标题为会话标题，命令块输出恢复出来
    await expect(page.getByText('total 1')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /^(展开|折叠)(全部)?$/ })).toHaveCount(0);
    // 恢复的块带颜色快照（output_html 持久化回读，非纯文本）
    await expect(page.locator('span[style*="#4e9a06"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid^="tab-row-"]', { hasText: '旧的调试会话' })).toHaveCount(1);
  });

  test('restoring one session from an archived group keeps it visible in the tab list', async ({ page }) => {
    await openHistory(page);
    const historyRow = page.getByText('归档分组中的会话');
    await expect(historyRow).toBeVisible();
    await historyRow.click();

    await ensureTabsOpen(page);
    const restoredTab = page.locator('[data-testid="tab-row-hist-group-1"]');
    await expect(restoredTab).toBeVisible();
    await expect(restoredTab).toHaveAttribute('data-tab-group', 'archived-group');
  });
});

test.describe('文件双击打开', () => {
  test('双击文件默认新建标签页并用终端编辑器打开', async ({ page }) => {
    await page.locator('[data-dock-btn="files"]').click();
    await expect(page.getByText('notes.txt')).toBeVisible();
    await page.getByText('notes.txt').dblclick();
    // 新建标签页（标题为文件名）
    await ensureTabsOpen(page);
    await expect(page.locator('[data-testid^="tab-row-"]', { hasText: 'notes.txt' })).toHaveCount(1);
    // 编辑器命令写入 PTY
    await expect.poll(() => ptyWrites(page)).toContain('vim /home/e2e/notes.txt\n');
  });
});
