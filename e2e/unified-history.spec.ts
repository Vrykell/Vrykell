import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test('unified history searches terminals and AI conversations and routes to their workspaces', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('e2e-conversations', JSON.stringify([{
      id: 'conversation-history', title: 'Explain deployment', created_at: Date.now() - 1000,
      updated_at: Date.now(), environment: '',
    }]));
    localStorage.setItem('e2e-conversation-messages', '[]');
  });
  await setupTauriMock(page, { schedulesSeed: [] });
  await page.goto('/');
  await page.getByTestId('workspace-history').click();
  const unified = page.getByTestId('unified-history-page');
  await expect(unified).toBeVisible();
  await expect(unified.getByText('旧的调试会话')).toBeVisible();
  await expect(unified.getByText('Explain deployment')).toBeVisible();

  const search = page.getByTestId('unified-history-search');
  await search.fill('deployment');
  await expect(unified.getByText('Explain deployment')).toBeVisible();
  await expect(unified.getByText('旧的调试会话')).toBeHidden();
  await search.fill('');
  await page.getByTestId('unified-history-conversation:conversation-history').click();
  await expect(page.getByTestId('workspace-area-ai')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('ai-surface-main').getByLabel('重命名对话')).toContainText('Explain deployment');

  await page.getByTestId('workspace-history').click();
  await page.getByTestId('unified-history-filter').click();
  await page.getByRole('button', { name: 'Terminal history', exact: true }).click();
  await expect(unified.getByText('旧的调试会话')).toBeVisible();
  await expect(unified.getByText('Explain deployment')).toBeHidden();

  await page.getByTestId('unified-history-session:hist-1').click();
  await expect(page.getByTestId('workspace-area-terminal')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('tab', { name: /旧的调试会话/ })).toBeVisible();
});
