import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { openWorkspaceActions } from './workbench';

test('an unavailable side dock keeps the same conversation visible in the main workspace', async ({ page }) => {
  await setupTauriMock(page, {}); await page.goto('/');
  await page.getByTestId('workspace-area-ai').click(); await page.getByTestId('ai-new-conversation').click();
  await page.setViewportSize({ width: 500, height: 800 });
  const composer = page.locator('[data-chat-composer]:visible');
  await composer.fill('keep my visible draft');
  await openWorkspaceActions(page);
  await page.getByRole('menuitem', { name: '将 AI 停靠到侧栏', exact: true }).click();
  await expect(page.getByTestId('ai-surface-main').locator('[data-chat-composer]')).toHaveValue('keep my visible draft');
  await expect(page.getByTestId('workspace-area-ai')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.workspace-side-panel:visible')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('空间不足');
});

test('AI utility pages become singleton tabs while docked conversations keep their draft', async ({ page }) => {
  await setupTauriMock(page, {}); await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await page.getByTestId('workspace-area-ai').click();
  await page.getByTestId('ai-new-conversation').click();
  await page.locator('[data-chat-composer]:visible').fill('keep the docked draft');
  await page.getByTestId('ai-relocate').click();
  const side = page.getByTestId('ai-surface-side');
  await side.getByRole('button', { name: '会话设置', exact: true }).click();
  const menu = page.getByRole('region', { name: '会话设置' });
  const links = menu.locator('.chat-setting-links');
  const buttons = links.getByRole('button');
  await expect(buttons).toHaveCount(3);
  const positions = await buttons.evaluateAll(items => items.map(item => ({ top: item.getBoundingClientRect().top, shared: item.classList.contains('outline-button') })));
  expect(positions.every(item => item.shared && Math.abs(item.top - positions[0]!.top) < 1)).toBe(true);
  await expect(buttons.last()).toHaveText('关闭'); await expect(buttons.last()).toHaveAttribute('data-tone', 'danger');
  await page.getByRole('region', { name: '会话设置' }).getByTestId('chat-usage-entry').click();
  // Utility pages are singleton tabs; the side conversation remains independently placed.
  await expect(page.locator('[data-testid="usage-page"]:visible')).toBeVisible();
  await expect(page.locator('[data-tab-kind="usage"]')).toHaveCount(1);
  const main = page.getByTestId('ai-surface-main');
  const strip = page.locator('[data-reorder-list="harness-sessions"]');
  await expect(strip.locator('[data-reorder-item]')).toHaveCount(1);
  await page.getByTestId('workspace-instance-bar').getByTestId('workspace-resource-switcher').click();
  await page.getByRole('menu', { name: '全部工作区标签' }).getByRole('menuitem', { name: '新对话', exact: true }).click();
  await expect(main.locator('[data-chat-composer]')).toHaveValue('keep the docked draft');
  // The AI history entry adds one more singleton page tab and renders the history page.
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: 'AI 对话历史', exact: true }).click();
  await expect(page.locator('[data-testid="unified-history-page"]:visible')).toBeVisible();
  await expect(strip.locator('[data-reorder-item^="page:"]')).toHaveCount(2);
});

test('hidden terminal splits do not reserve the resource or code workspace width', async ({ page }) => {
  await setupTauriMock(page, {}); await page.goto('/');
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
