import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { fillHistorySearch } from './history-search';

test('unified history searches terminals and AI conversations and routes to their workspaces', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('e2e-conversations', JSON.stringify([{
      id: 'conversation-history', title: 'Explain deployment', created_at: Date.now() - 1000,
      updated_at: Date.now(), environment: '',
    }]));
    localStorage.setItem('e2e-conversation-messages', '[]');
  });
  await setupTauriMock(page, {});
  await page.goto('/');
  await page.getByTestId('workspace-history').click();
  const unified = page.getByTestId('unified-history-page');
  await expect(unified).toBeVisible();
  await expect(unified.getByText('旧的调试会话')).toBeVisible();
  await expect(unified.getByText('Explain deployment')).toBeVisible();
  const groupButton = page.getByTestId('unified-history-group-by');
  await groupButton.click();
  const groupMenu = page.getByTestId('unified-history-group-menu');
  await expect(groupMenu).toBeVisible();
  const groupButtonBox = (await groupButton.boundingBox())!;
  const groupMenuBox = (await groupMenu.boundingBox())!;
  expect(Math.abs(groupMenuBox.x + groupMenuBox.width - groupButtonBox.x - groupButtonBox.width)).toBeLessThanOrEqual(1);
  await page.keyboard.press('Escape');
  const terminalRow = unified.getByTestId('unified-history-session:hist-1');
  await terminalRow.hover();
  await expect(page.getByTestId('unified-history-open-session:hist-1')).toBeVisible();
  await expect(page.getByTestId('unified-history-delete-session:hist-1')).toBeVisible();
  await terminalRow.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '复制摘要', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '添加备注…', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '锁定记录', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  await fillHistorySearch(page, 'unified-history-search', 'deployment');
  await expect(unified.getByText('Explain deployment')).toBeVisible();
  await expect(unified.getByText('旧的调试会话')).toBeHidden();
  await fillHistorySearch(page, 'unified-history-search', '');
  await page.getByTestId('unified-history-conversation:conversation-history').click();
  await expect(page.getByTestId('workspace-area-ai')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('workspace-instance-bar').getByRole('tab', { name: 'Explain deployment', exact: true })).toBeVisible();

  await page.getByTestId('workspace-history').click();
  await page.getByTestId('unified-history-filter').click();
  await page.getByRole('button', { name: '终端历史', exact: true }).click();
  await expect(unified.getByText('旧的调试会话')).toBeVisible();
  await expect(unified.getByText('Explain deployment')).toBeHidden();

  await page.getByTestId('unified-history-session:hist-1').click();
  await expect(page.getByTestId('workspace-area-terminal')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('tab', { name: /旧的调试会话/ })).toBeVisible();
});

test('filter cards stay on one line and secondary controls collapse into more actions', async ({ page }) => {
  await setupTauriMock(page, {});
  await page.goto('/');
  await page.getByTestId('workspace-history').click();
  await page.getByTestId('unified-history-filter').click();
  await page.getByRole('button', { name: '终端历史', exact: true }).click();
  await page.getByRole('button', { name: '块终端', exact: true }).click();
  await page.getByRole('button', { name: '近 7 天', exact: true }).click();
  await page.keyboard.press('Escape');

  const cards = page.getByTestId('history-filter-cards');
  await expect(cards.locator('.search-scope-chip')).toHaveCount(3);
  await page.setViewportSize({ width: 560, height: 700 });
  await expect.poll(() => cards.evaluate(element => getComputedStyle(element).flexWrap)).toBe('nowrap');
  await expect(cards).toHaveCSS('overflow-x', 'hidden');
  await expect(page.getByTestId('unified-history-filter')).toBeHidden();
  await expect(page.getByTestId('unified-history-sort')).toBeHidden();
  await expect(page.getByTestId('unified-history-group-by')).toBeHidden();
  await expect(page.getByTestId('history-search-toggle')).toBeVisible();
  await page.getByTestId('unified-history-actions').click();
  await expect(page.getByRole('menuitem', { name: '筛选历史', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '历史排序', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '分组方式', exact: true })).toBeVisible();
});
