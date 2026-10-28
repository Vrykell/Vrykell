import { test, expect } from '@playwright/test';
import { setupTauriMock, ptyWrites, ensureTabsOpen } from './tauri-mock';
import { fillHistorySearch } from './history-search';

async function openHistory(page: import('@playwright/test').Page) {
  await ensureTabsOpen(page);
  await page.locator('[data-testid="tab-history-btn"]').click();
}

test.beforeEach(async ({ page }, testInfo) => {
  await setupTauriMock(page, { groupedHistoricalSession: testInfo.title === 'restoring one session from an archived group keeps it visible in the tab list' });
  await page.goto('/');
});

test.describe('Session history management', () => {
  test('startup restores the last active session automatically', async ({ page }) => {
    // The mock list_sessions returns t1 with status=active, so it is restored as a tab on startup
    // (the restored tab id is t1, distinct from the module-level default tab).
    await ensureTabsOpen(page);
    await expect(page.locator('[data-testid="tab-row-t1"]')).toBeVisible({ timeout: 5000 });
  });

  test('filtering: the search box and filter menu narrow sessions and the state is remembered within the session', async ({ page }) => {
    await openHistory(page);
    await expect(page.getByText('旧的调试会话')).toBeVisible();
    // Search filtering.
    await fillHistorySearch(page, 'unified-history-search', '不存在的会话');
    await expect(page.getByText('旧的调试会话')).toHaveCount(0);
    await fillHistorySearch(page, 'unified-history-search', '');
    await expect(page.getByText('旧的调试会话')).toBeVisible();
    // Filter menu: pick SSH (the history session is local, so it disappears).
    await page.locator('[data-testid="unified-history-filter"]').click();
    const menu = page.locator('[data-testid="unified-history-filter-menu"]');
    await menu.getByRole('button', { name: 'SSH' }).click();
    await expect(page.getByText('旧的调试会话')).toHaveCount(0);
    // Filter choices stay open until dismissed or their trigger is toggled.
    await menu.locator('[data-history-option-section="连接类型"]').getByRole('button', { name: '全部' }).click();
    await expect(page.getByText('旧的调试会话')).toBeVisible();
    // The selected filters survive a reload in the same application session.
    await page.locator('[data-testid="unified-history-filter-menu"]').getByRole('button', { name: 'SSH' }).click();
    await page.reload();
    // Open the session history page idempotently (the panel state may be persisted, so avoid toggling it closed).
    await expect(page.locator('[data-testid^="tab-row-"]').first()).toBeVisible();
    if (!(await page.locator('[data-testid="tab-history-btn"]').isVisible().catch(() => false))) {
      await ensureTabsOpen(page);
    }
    await expect(page.locator('[data-testid="tab-history-btn"]')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="tab-history-btn"]').click();
    await expect(page.getByText('旧的调试会话')).toHaveCount(0);
  });

  test('history sessions can be deleted', async ({ page }) => {
    await openHistory(page);
    await expect(page.getByText('旧的调试会话')).toBeVisible();
    const record = page.getByTestId('unified-history-session:hist-1');
    const remove = page.getByTestId('unified-history-menu-session:hist-1');
    const quickActions = record.locator('.history-row-quick-actions');
    await expect(remove).toHaveCSS('opacity', '0');
    await expect(quickActions).toHaveCSS('opacity', '0');
    await record.focus();
    await expect(remove).toHaveCSS('opacity', '1');
    await expect(quickActions).toHaveCSS('opacity', '1');
    await remove.click();
    await page.getByRole('menuitem', { name: '删除此会话', exact: true }).click();
    await expect(page.getByText('旧的调试会话')).toHaveCount(0);
    await expect(page.getByText('暂无历史记录')).toBeVisible();
  });

  test('restoring a history session restores its command blocks', async ({ page }) => {
    await openHistory(page);
    // Click the history session to restore it.
    await page.getByText('旧的调试会话').click();
    // The new tab takes the session title and the command block output is restored.
    await expect(page.getByText('total 1')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /^(展开|折叠)(全部)?$/ })).toHaveCount(0);
    // The restored block carries a colored snapshot (output_html read back from persistence, not plain text).
    await expect(page.locator('span[style*="#4e9a06"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid^="tab-row-"]', { hasText: '旧的调试会话' })).toHaveCount(1);
  });

  test('restoring one session from an archived group keeps it visible in the tab list', async ({ page }) => {
    await openHistory(page);
    const historyRow = page.getByTestId('history-group-card-source:archived-group').getByText('归档分组中的会话');
    await expect(historyRow).toBeVisible();
    await historyRow.click();

    await ensureTabsOpen(page);
    const restoredTab = page.locator('[data-testid="tab-row-hist-group-1"]');
    await expect(restoredTab).toBeVisible();
    await expect(restoredTab).toHaveAttribute('data-tab-group', 'archived-group');
  });
});

test.describe('Opening files by double-click', () => {
  test('double-clicking a file opens it in an editor page by default instead of typing into the terminal', async ({ page }) => {
    await page.locator('[data-dock-btn="files"]').click();
    await expect(page.getByText('notes.txt')).toBeVisible();
    await page.getByText('notes.txt').dblclick();
    // The default preference is the built-in editor: the file opens in an editor page and no vim
    // command reaches the terminal.
    await expect(page.getByTestId('file-editor')).toBeVisible();
    await expect(page.getByTestId('file-editor').locator('.monaco-editor')).toBeVisible({ timeout: 15_000 });
    expect((await ptyWrites(page)).some(call => call.includes('vim'))).toBe(false);
  });
});
