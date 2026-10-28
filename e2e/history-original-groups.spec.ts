import { expect, test, type Page } from '@playwright/test';
import { ensureTabsOpen, setupTauriMock } from './tauri-mock';
import { fillHistorySearch } from './history-search';

async function openHistory(page: Page) {
  await ensureTabsOpen(page);
  await page.getByTestId('tab-history-btn').click();
  await expect(page.getByTestId('unified-history-page')).toBeVisible();
}

async function classify(page: Page, name: string) {
  await page.getByTestId('unified-history-group-by').click();
  await page.getByTestId('unified-history-group-menu').getByRole('button', { name, exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page, { groupedHistoricalSession: true });
  await page.goto('/');
  await openHistory(page);
});

test('original groups remain intact across classifications, filters and persisted renaming', async ({ page }, testInfo) => {
  const card = page.getByTestId('history-group-card-source:archived-group');
  await expect(card.getByRole('heading', { name: '已归档分组' })).toBeVisible();
  await expect(card.locator('.history-row')).toHaveCount(3);
  await classify(page, '工作目录');
  await expect(card.locator('.history-group-subtitle')).toHaveText('原标签组 · 多个工作目录');
  await fillHistorySearch(page, 'unified-history-search', 'Backend');
  await expect(card.locator('.history-row')).toHaveCount(1);
  await expect(card.locator('.history-group-count')).toHaveText('1 / 3 个会话');
  await expect(card.getByRole('button', { name: '恢复匹配项', exact: true })).toHaveCount(0);
  await expect(card.locator('.history-group-subtitle')).toHaveText('原标签组 · 多个工作目录');
  await card.getByRole('button', { name: '分组操作' }).click();
  await expect(page.getByRole('menuitem', { name: '恢复匹配项', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '恢复原组全部 3 个会话' })).toBeVisible();
  await page.getByRole('menuitem', { name: '重命名分组…' }).click();
  const name = page.getByRole('textbox', { name: '分组名称' });
  await name.fill('Project Aurora');
  await name.press('Enter');
  await expect(card.getByRole('heading', { name: 'Project Aurora' })).toBeVisible();
  await fillHistorySearch(page, 'unified-history-search', 'Aurora');
  await expect(card.locator('.history-row')).toHaveCount(3);
  await card.getByRole('button', { name: '分组操作' }).click();
  await page.getByRole('menuitem', { name: '置顶分组', exact: true }).click();
  await classify(page, '按天');
  await expect(card).toHaveAttribute('data-pinned', 'true');
  await expect(card.getByRole('heading', { name: 'Project Aurora' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('original-history-card.png'), animations: 'disabled' });
});

test('restores original membership and order and retains history after the last group member closes', async ({ page }, testInfo) => {
  const card = page.getByTestId('history-group-card-source:archived-group');
  await fillHistorySearch(page, 'unified-history-search', 'Backend');
  await card.getByRole('button', { name: '分组操作' }).click();
  await page.getByRole('menuitem', { name: '恢复匹配项', exact: true }).click();
  await ensureTabsOpen(page);
  await expect(page.getByTestId('tab-row-hist-group-2')).toHaveAttribute('data-tab-group', 'archived-group');
  await expect(page.getByTestId('tab-row-hist-group-1')).toHaveCount(0);
  await expect(page.getByTestId('tab-row-hist-group-3')).toHaveCount(0);
  await openHistory(page);
  await fillHistorySearch(page, 'unified-history-search', 'Frontend');
  await expect(card.locator('.history-group-count')).toHaveText('1 / 2 个会话');
  await card.getByRole('button', { name: '分组操作' }).click();
  await page.getByRole('menuitem', { name: '恢复原组全部 2 个会话' }).click();
  await ensureTabsOpen(page);
  const tabs = page.locator('[data-tab-row-id][data-tab-group="archived-group"]');
  await expect(tabs).toHaveCount(3);
  await expect.poll(() => tabs.evaluateAll(items => items.map(item => item.getAttribute('data-tab-row-id'))))
    .toEqual(['hist-group-1', 'hist-group-2', 'hist-group-3']);
  for (const id of ['hist-group-1', 'hist-group-2', 'hist-group-3']) {
    await page.getByTestId(`tab-row-${id}`).hover();
    await page.getByTestId(`tab-close-${id}`).click();
  }
  await openHistory(page);
  await fillHistorySearch(page, 'unified-history-search', '');
  // Closing the last member removes its empty group, while each session remains in history.
  await expect(card).toHaveCount(0);
  for (const title of ['归档分组中的会话', 'Backend', 'Frontend']) {
    await expect(page.getByTestId('unified-history-page').locator('.history-row').filter({ hasText: title })).toHaveCount(1);
  }
  await page.screenshot({ path: testInfo.outputPath('original-group-after-individual-close.png'), animations: 'disabled' });
});
