import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

for (const theme of ['dark', 'light']) test(`compact shared fields, authentication tabs and tag rows in ${theme}`, async ({ page }, info) => {
  await setupTauriMock(page, { schedulesSeed: [] });
  await page.addInitScript(theme => {
    localStorage.setItem('vrykell-theme-mode', theme);
    localStorage.setItem('vrykell-host-library', JSON.stringify({ state: { hosts: { 'ssh-1': { group: 'Production', tags: ['production', 'api'], starred: true } } }, version: 0 }));
  }, theme);
  await page.goto('/'); await page.getByTestId('workspace-area-ssh').click(); await page.getByTestId('ssh-new-btn').click();
  const editor = page.getByTestId('ssh-host-editor');
  await expect(editor.getByRole('radiogroup', { name: '认证方式' }).getByRole('radio')).toHaveCount(4);
  await expect(editor.getByTestId('ssh-form-name')).toHaveClass(/text-input-field/);
  const card = editor.locator('#ssh-section-connection .ssh-form-section-fields');
  expect((await card.boundingBox())!.width).toBeLessThanOrEqual(720);
  expect((await card.boundingBox())!.height).toBeLessThan(150);
  await editor.getByRole('radio', { name: '密钥', exact: true }).click(); await expect(editor.getByTestId('ssh-form-identity')).toBeVisible();
  await editor.getByRole('radio', { name: '密码', exact: true }).click(); await expect(editor.getByTestId('ssh-form-password')).toBeVisible();
  const tagInput = editor.getByTestId('ssh-form-tag');
  await expect(tagInput).toHaveClass(/text-input-field/); await expect(editor.getByRole('combobox', { name: '已有标签' })).toHaveCount(0);
  await editor.getByRole('button', { name: '已有标签', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'production', exact: true }).click(); await page.keyboard.press('Escape');
  await expect(editor.locator('.tag-input-chip')).toHaveText('production');
  await tagInput.fill('new-tag'); await tagInput.press('Enter'); await expect(editor.locator('.tag-input-chip')).toHaveCount(2);
  await expect(editor.getByTestId('ssh-env-name-0')).toHaveAttribute('placeholder', '变量名');
  const variable = editor.getByTestId('ssh-env-name-0'); await variable.scrollIntoViewIfNeeded();
  await expect(variable).toHaveClass(/text-input-field/); await expect(editor.locator('.ssh-environment-rows > div').first()).toHaveCSS('border-top-width', '0px');
  await editor.getByRole('button', { name: '移除变量', exact: true }).click(); await expect(editor.getByTestId('ssh-env-add')).toHaveCSS('border-top-width', '0px');
  await editor.getByTestId('ssh-env-add').click(); await editor.getByTestId('ssh-form-ai-notes').scrollIntoViewIfNeeded();
  const summary = editor.locator('.ssh-editor-advanced > summary'); await expect(summary).toHaveCSS('list-style-type', 'none'); await expect(summary.locator('svg')).toBeVisible();
  await page.screenshot({ path: info.outputPath(`editor-bottom-${theme}.png`), animations: 'disabled' });
  await editor.getByTestId('ssh-form-name').scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath(`editor-top-${theme}.png`), animations: 'disabled' });
});
