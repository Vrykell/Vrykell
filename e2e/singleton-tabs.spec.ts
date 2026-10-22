import { expect, test } from '@playwright/test';
import { ensureTabsOpen, setupTauriMock } from './tauri-mock';

test('settings stay outside the tab list while history opens one singleton tab per workspace', async ({ page }) => {
  await setupTauriMock(page); await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await ensureTabsOpen(page);
  const before = await page.locator('[data-tab-row-id]').count();
  await page.keyboard.press('Meta+,');
  await expect(page.locator('.settings-screen')).toBeVisible();
  await expect(page.locator('[data-tab-kind="settings"]')).toHaveCount(0);
  await page.keyboard.press('Meta+,');
  await expect(page.locator('.settings-screen')).toBeVisible();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await expect(page.locator('[data-tab-row-id]')).toHaveCount(before);
  // The terminal history entry opens one singleton tab in the terminal strip.
  await page.getByTestId('tab-history-btn').click();
  const history = page.locator('[data-testid="unified-history-page"]:visible');
  await expect(history).toBeVisible();
  await expect(history.getByTestId('unified-history-session:hist-1')).toBeVisible();
  await expect(page.locator('[data-tab-kind="history"]')).toHaveCount(1);
  // Reopening reuses the same tab instead of stacking another one.
  await page.getByTestId('tab-history-btn').click();
  await expect(page.locator('[data-tab-kind="history"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="unified-history-page"]:visible')).toHaveCount(1);
  // The global history entry keeps the workspace page and never adds a tab.
  await page.getByTestId('workspace-history').click();
  await expect(page.locator('[data-testid="unified-history-page"]:visible').locator('.history-heading strong')).toContainText('全部历史');
  await expect(page.locator('[data-tab-kind="history"]')).toHaveCount(1);
});

test('local and SSH tabs retain colored tiles before and after activation', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await ensureTabsOpen(page);
  await page.evaluate(async () => {
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    useWorkspaceStore.getState().addTab({ shellType: 'bash', title: 'Local test' });
    useWorkspaceStore.getState().addTab({ kind: 'ssh', title: 'Remote test', ssh: { name: 'Remote test', host: 'example.invalid' } });
  });
  for (const [label, mark] of [['Local test', 'bash'], ['Remote test', 'ssh']]) {
    const row = page.locator('[data-tab-row-id]').filter({ hasText: label });
    const icon = row.locator('svg').first();
    await expect(icon).toHaveAttribute('data-shell-mark', mark);
    await expect(icon).toHaveCSS('width', '16px');
    await expect(icon).toHaveCSS('height', '16px');
    await expect(icon).toHaveAttribute('style', new RegExp(`color: var\\(--shell-${mark}-accent\\)`));
    const color = await icon.evaluate(element => getComputedStyle(element).color);
    await row.click();
    await expect(icon).toHaveCSS('color', color);
  }
});

