import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test('an unavailable side dock keeps the same conversation visible in the main workspace', async ({ page }) => {
  await setupTauriMock(page, { schedulesSeed: [] }); await page.goto('/');
  await page.setViewportSize({ width: 560, height: 800 });
  await page.getByTestId('workspace-area-ai').click(); await page.getByTestId('ai-new-conversation').click();
  const composer = page.locator('[data-chat-composer]:visible');
  await composer.fill('keep my visible draft');
  await page.getByTestId('ai-relocate').click();
  await expect(page.getByTestId('ai-surface-main').locator('[data-chat-composer]')).toHaveValue('keep my visible draft');
  await expect(page.getByTestId('workspace-area-ai')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.workspace-side-panel:visible')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('空间不足');
});

test('main utility pages and docked conversations keep separate shortcut scopes', async ({ page }) => {
  await setupTauriMock(page, { schedulesSeed: [] }); await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await page.getByTestId('workspace-area-ai').click();
  await page.getByTestId('ai-new-conversation').click();
  await page.locator('[data-chat-composer]:visible').fill('keep the docked draft');
  await page.getByTestId('ai-relocate').click();
  const side = page.getByTestId('ai-surface-side');
  await side.getByRole('button', { name: '用量统计', exact: true }).click();
  await expect(page.getByTestId('usage-page')).toBeVisible();
  await side.getByRole('button', { name: 'AI 对话历史', exact: true }).click();
  await expect(page.getByTestId('ai-history-page')).toBeVisible();
  const strip = page.getByTestId('workspace-instance-bar');
  await strip.getByRole('tab').last().click();
  await page.keyboard.press('Control+1');
  await expect(page.getByTestId('usage-page')).toBeVisible();
  await page.keyboard.press('Control+2');
  await expect(page.getByTestId('ai-history-page')).toBeVisible();
  await page.keyboard.press('Control+w'); await page.keyboard.press('Control+w');
  await expect(page.getByTestId('ai-workspace-empty')).toBeVisible();
  await expect(side.getByRole('tab')).toHaveCount(1);
  await expect(side.locator('[data-chat-composer]')).toHaveValue('keep the docked draft');
  await page.getByTestId('ai-workspace-empty').getByRole('button').click();
  await expect(page.getByTestId('ai-surface-main').locator('[data-chat-composer]')).toHaveValue('keep the docked draft');
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
  await page.getByTestId('workspace-area-ssh').click();
  await page.locator('[data-dock-btn="files"]').click();
  const panel = page.locator('.workspace-side-panel[data-visible="true"]');
  expect((await panel.boundingBox())!.width).toBe(200);
  await expect(page.getByTestId('ssh-search')).toBeVisible();
  await page.getByTestId('workspace-area-code').click();
  expect((await panel.boundingBox())!.width).toBe(200);
  await expect(page.getByTestId('code-workspace-empty')).toBeVisible();
});
