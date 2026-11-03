import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

for (const filter of [
  { trigger: 'ssh-host-tag-filter', title: '主机标签', option: 'production' },
  { trigger: 'ssh-host-group-filter', title: '主机分组', option: 'Production' },
]) test(`${filter.trigger} dismisses outside and across workspace changes while retaining selection`, async ({ page }) => {
  await setupTauriMock(page);
  await page.addInitScript(() => {
    localStorage.setItem('vrykell-host-library', JSON.stringify({ state: { hosts: { 'ssh-1': { group: 'Production', tags: ['production'], starred: false } } }, version: 0 }));
  });
  await page.goto('/');
  await page.getByTestId('workspace-area-ssh').click();
  const trigger = page.getByTestId(filter.trigger);
  const menu = page.getByRole('menu', { name: filter.title, exact: true });
  await trigger.click();
  await page.getByRole('menuitemcheckbox', { name: filter.option, exact: true }).click();
  await expect(menu).toBeVisible();
  await page.getByTestId('ssh-search').click();
  await expect(menu).toHaveCount(0);
  await trigger.click();
  await expect(page.getByRole('menuitemcheckbox', { name: filter.option, exact: true })).toBeChecked();
  await page.getByTestId('workspace-area-ai').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('ssh-workspace')).toBeHidden();
  await expect(menu).toHaveCount(0);
  await page.getByTestId('workspace-area-ssh').click();
  await expect(menu).toHaveCount(0);
  await trigger.click();
  await expect(page.getByRole('menuitemcheckbox', { name: filter.option, exact: true })).toBeChecked();
  await page.getByTestId('workspace-area-code').click();
  await expect(menu).toHaveCount(0);
  await page.getByTestId('workspace-area-ssh').click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});
