import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test('visual review surfaces', async ({ page }, info) => {
  await setupTauriMock(page, {});
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();

  // 1. Terminal start page after closing the only tab.
  const tab = page.locator('[data-tab-row-id]').first();
  await tab.hover();
  await tab.locator('[data-testid^="tab-close-"]').click();
  await expect(page.getByTestId('start-page')).toBeVisible();
  await page.screenshot({ path: info.outputPath('01-terminal-start.png'), animations: 'disabled' });

  // 2. Code start page.
  await page.getByTestId('workspace-area-code').click();
  await expect(page.getByTestId('code-start-page')).toBeVisible();
  await page.screenshot({ path: info.outputPath('02-code-start.png'), animations: 'disabled' });

  // 3. AI start page and the ACP picker.
  await page.getByTestId('workspace-area-ai').click();
  await expect(page.getByTestId('ai-start-page')).toBeVisible();
  await page.screenshot({ path: info.outputPath('03-ai-start.png'), animations: 'disabled' });
  await page.getByTestId('harness-add-session').click();
  await expect(page.getByTestId('acp-launcher')).toBeVisible();
  await page.screenshot({ path: info.outputPath('04-acp-picker.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');

  // 4. Terminal history page: canvas toolbar, filter chip and cards.
  await page.getByTestId('workspace-area-terminal').click();
  await page.getByTestId('tab-history-btn').click();
  await expect(page.locator('[data-testid="unified-history-page"]:visible')).toBeVisible();
  await page.screenshot({ path: info.outputPath('05-history.png'), animations: 'disabled' });

  // 5. Settings content and cards.
  await page.getByTestId('workspace-settings').click();
  await expect(page.locator('.settings-view')).toBeVisible();
  await page.screenshot({ path: info.outputPath('06-settings.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');

  // 6. Usage page cards.
  await page.getByTestId('workspace-area-ai').click();
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: '用量统计', exact: true }).click();
  await expect(page.getByTestId('usage-page')).toBeVisible();
  await page.screenshot({ path: info.outputPath('07-usage.png'), animations: 'disabled' });

  // 7. Git panel docked on the left: heading and close button must fit the sidebar.
  await page.evaluate(async () => {
    const { useDockStore } = await import('/src/features/workspace/stores/dock.ts');
    useDockStore.getState().moveButton('git', 'left');
    useDockStore.getState().openPanel('git');
  });
  await expect(page.locator('.workspace-side-panel[data-side="left"] .git-panel')).toBeVisible();
  await page.screenshot({ path: info.outputPath('08-git-left.png'), animations: 'disabled' });
});
