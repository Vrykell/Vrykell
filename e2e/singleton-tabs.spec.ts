import { expect, test } from '@playwright/test';
import { ensureTabsOpen, setupTauriMock } from './tauri-mock';

test('settings and history are visible singleton tabs with switching, filtering and closing', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await ensureTabsOpen(page);
  await page.keyboard.press('Meta+,');
  const settings = page.locator('[data-tab-kind="settings"]');
  await expect(settings).toHaveCount(1);
  await expect(settings).toBeVisible();
  await page.keyboard.press('Meta+,');
  await expect(settings).toHaveCount(1);
  await page.getByTestId('tab-history-btn').click();
  const history = page.locator('[data-tab-kind="history"]');
  await expect(history).toHaveCount(1);
  await expect(history).toBeVisible();
  await page.getByTestId('tab-history-btn').click();
  await expect(history).toHaveCount(1);
  await settings.click();
  await expect(page.locator('aside')).toBeVisible();
  await settings.click({ button: 'right' });
  await expect(page.getByRole('button', { name: '复制会话', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await history.click();
  await expect(page.getByTestId('session-filter-input')).toBeVisible();
  await page.getByTestId('tab-search').fill('设置');
  await expect(settings).toBeVisible();
  await expect(history).toHaveCount(0);
  await page.getByTestId('tab-search').fill('');
  await history.getByRole('button', { name: '关闭标签', exact: true }).click();
  await expect(history).toHaveCount(0);
  await page.getByTestId('tab-history-btn').click();
  await expect(history).toHaveCount(1);
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
    const badge = icon.locator('..');
    await expect(badge).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(badge).toHaveCSS('width', '20px');
    await expect(badge).toHaveCSS('height', '20px');
    await expect(icon).toHaveAttribute('style', new RegExp(`color: var\\(--shell-${mark}-accent\\)`));
    const color = await icon.evaluate(element => getComputedStyle(element).color);
    await row.click();
    await expect(icon).toHaveCSS('color', color);
  }
});

