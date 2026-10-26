import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test('observed host metadata is used in the profile picker', async ({ page }) => {
  await setupTauriMock(page, {});
  await page.addInitScript(() => {
    localStorage.setItem('vrykell-host-systems', JSON.stringify({ state: { systems: { 'ssh-1': 'Ubuntu' } }, version: 0 }));
  });
  await page.goto('/');
  await page.getByTestId('tab-new-btn').click();
  await expect(page.getByTestId('new-tab-option-ssh:ssh-1').locator('[data-shell-mark]')).toHaveAttribute('data-shell-mark', 'ubuntu');
});
