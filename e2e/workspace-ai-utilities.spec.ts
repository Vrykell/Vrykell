import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test('an unavailable side dock keeps the same conversation visible in the main workspace', async ({ page }) => {
  await setupTauriMock(page, { schedulesSeed: [] }); await page.goto('/');
  await page.getByTestId('workspace-area-ai').click(); await page.getByTestId('ai-new-conversation').click();
  await page.setViewportSize({ width: 500, height: 800 });
  const composer = page.locator('[data-chat-composer]:visible');
  await composer.fill('keep my visible draft');
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: '更多编辑器操作' }).click();
  await page.getByRole('button', { name: '将 AI 停靠到侧栏', exact: true }).click();
  await expect(page.getByTestId('ai-surface-main').locator('[data-chat-composer]')).toHaveValue('keep my visible draft');
  await expect(page.getByTestId('workspace-area-ai')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.workspace-side-panel:visible')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('空间不足');
});

test('AI utility pages become singleton tabs while docked conversations keep their draft', async ({ page }) => {
  await setupTauriMock(page, { schedulesSeed: [] }); await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await page.getByTestId('workspace-area-ai').click();
  await page.getByTestId('ai-new-conversation').click();
  await page.locator('[data-chat-composer]:visible').fill('keep the docked draft');
  await page.getByTestId('ai-relocate').click();
  const side = page.getByTestId('ai-surface-side');
  await side.getByRole('button', { name: '会话设置', exact: true }).click();
  await page.getByRole('region', { name: '会话设置' }).getByTestId('chat-usage-entry').click();
  // Usage is a singleton tab in the AI strip, so the workspace returns to main and the panel closes.
  await expect(page.locator('[data-testid="usage-page"]:visible')).toBeVisible();
  await expect(page.locator('[data-tab-kind="usage"]')).toHaveCount(1);
  const main = page.getByTestId('ai-surface-main');
  const strip = page.locator('[data-reorder-list="harness-sessions"]');
  await expect(strip.locator('[data-reorder-item]')).toHaveCount(2);
  // Selecting the conversation tab brings the docked conversation back with its draft.
  await strip.locator('[data-reorder-item]:not([data-reorder-item^="page:"])').first().click();
  await expect(main.locator('[data-chat-composer]')).toHaveValue('keep the docked draft');
  // The AI history entry adds one more singleton page tab and renders the history page.
  await page.getByRole('button', { name: 'AI 对话历史', exact: true }).click();
  await expect(page.locator('[data-testid="unified-history-page"]:visible')).toBeVisible();
  await expect(strip.locator('[data-reorder-item^="page:"]')).toHaveCount(2);
});

test('hidden terminal splits do not reserve the resource or code workspace width', async ({ page }) => {
  await setupTauriMock(page, { schedulesSeed: [] }); await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await page.evaluate(async () => {
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    useWorkspaceStore.getState().splitFocusedDirect('row');
    useWorkspaceStore.getState().splitFocusedDirect('row');
  });
  await page.getByTestId('workspace-sidebar-expand').click();
  await page.getByTestId('workspace-area-ssh').click();
  await page.locator('[data-dock-btn="files"]').click();
  const panel = page.locator('.workspace-side-panel[data-visible="true"]');
  expect((await panel.boundingBox())!.width).toBe(200);
  await expect(page.getByTestId('ssh-search')).toBeVisible();
  await page.getByTestId('workspace-sidebar-expand').click();
  await page.getByTestId('workspace-area-code').click();
  expect((await panel.boundingBox())!.width).toBe(200);
  await expect(page.getByTestId('code-start-page')).toBeVisible();
});
