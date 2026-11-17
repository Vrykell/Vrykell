import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

for (const theme of ['dark', 'light'])
  test(`compact shared fields, authentication tabs and tag rows in ${theme}`, async ({ page }, info) => {
    await setupTauriMock(page, {});
    await page.addInitScript((theme) => {
      localStorage.setItem('vrykell-theme-mode', theme);
      localStorage.setItem(
        'vrykell-host-library',
        JSON.stringify({ state: { hosts: { 'ssh-1': { group: 'Production', tags: ['production', 'api'], starred: true } } }, version: 0 }),
      );
    }, theme);
    await page.goto('/');
    await page.getByTestId('workspace-area-ssh').click();
    await page.getByTestId('ssh-new-btn').click();
    const editor = page.getByTestId('ssh-host-editor');
    await expect(editor.getByRole('radiogroup', { name: '认证方式' }).getByRole('radio')).toHaveCount(4);
    await expect(editor.getByTestId('ssh-form-name')).toHaveClass(/text-input-field/);
    const card = editor.locator('#ssh-section-connection .ssh-form-section-fields');
    expect((await card.boundingBox())!.width).toBeLessThanOrEqual(720);
    expect((await card.boundingBox())!.height).toBeLessThan(150);
    await editor.getByRole('radio', { name: '密钥', exact: true }).click();
    await expect(editor.getByTestId('ssh-form-identity')).toBeVisible();
    await editor.getByRole('radio', { name: '密码', exact: true }).click();
    await expect(editor.getByTestId('ssh-form-password')).toBeVisible();
    const tagInput = editor.getByTestId('ssh-form-tag');
    await expect(tagInput).toHaveClass(/text-input-field/);
    await expect(editor.getByRole('combobox', { name: '已有标签' })).toHaveCount(0);
    await editor.getByRole('button', { name: '已有标签', exact: true }).click();
    await page.getByRole('menuitemcheckbox', { name: 'production', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(editor.locator('.tag-input-chip')).toHaveText('production');
    await tagInput.fill('new-tag');
    await tagInput.press('Enter');
    await expect(editor.locator('.tag-input-chip')).toHaveCount(2);
    await expect(editor.locator('.tag-input-field')).toHaveCSS('height', '28px');
    await expect(editor.getByTestId('ssh-env-name-0')).toHaveAttribute('placeholder', '变量名');
    const variable = editor.getByTestId('ssh-env-name-0');
    await variable.scrollIntoViewIfNeeded();
    await expect(variable).toHaveClass(/text-input-field/);
    await expect(editor.locator('.ssh-environment-rows > div').first()).toHaveCSS('border-top-width', '0px');
    await editor.getByRole('button', { name: '移除变量', exact: true }).click();
    await expect(editor.getByTestId('ssh-env-add').locator('..')).toHaveCSS('border-top-width', '0px');
    await editor.getByTestId('ssh-env-add').click();
    await editor.getByTestId('ssh-form-ai-notes').scrollIntoViewIfNeeded();
    const summary = editor.locator('.ssh-editor-advanced > summary');
    await expect(summary).toHaveCSS('list-style-type', 'none');
    await expect(summary.locator('svg')).toBeVisible();
    if (await summary.locator('..').evaluate((element) => !element.hasAttribute('open'))) await summary.click();
    const addForward = editor.getByTestId('ssh-forward-add');
    await expect(addForward).toHaveCSS('border-radius', '8px');
    await page.screenshot({ path: info.outputPath(`editor-bottom-${theme}.png`), animations: 'disabled' });
    await editor.getByTestId('ssh-form-name').scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`editor-top-${theme}.png`), animations: 'disabled' });
  });

test('password reveal stays inside the field and keeps the caret', async ({ page }) => {
  await setupTauriMock(page, {});
  await page.goto('/');
  await page.getByTestId('workspace-area-ssh').click();
  await page.getByTestId('ssh-new-btn').click();
  const editor = page.getByTestId('ssh-host-editor');
  const password = editor.getByTestId('ssh-form-password');
  await expect(password).toHaveCSS('min-height', '28px');
  await expect(password).toHaveCSS('padding-top', '4px');
  // The themed control is present before anything is typed; the WebView's own eye is hidden.
  await expect(editor.getByRole('button', { name: '显示密码', exact: true })).toBeVisible();
  await password.fill('secret');
  await password.focus();
  await password.evaluate((element: HTMLInputElement) => element.setSelectionRange(2, 2));
  await editor.getByRole('button', { name: '显示密码', exact: true }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(password).toBeFocused();
  expect(await password.evaluate((element: HTMLInputElement) => element.selectionStart)).toBe(2);
  await editor.getByRole('button', { name: '隐藏密码', exact: true }).click();
  await expect(password).toHaveAttribute('type', 'password');
  await expect(password).toBeFocused();
  expect(await password.evaluate((element: HTMLInputElement) => element.selectionStart)).toBe(2);
});

test('quick connection reuses the connection form cards without a native disclosure marker', async ({ page }, info) => {
  await setupTauriMock(page, {});
  await page.goto('/');
  await page.getByTestId('workspace-area-ssh').click();
  await page.getByTestId('ssh-host-actions').click();
  await page.getByRole('button', { name: '快速连接', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'SSH 连接' });
  await page.setViewportSize({ width: 1240, height: 800 });
  await expect(form.locator('.ssh-editor-advanced > summary')).toBeHidden();
  await expect(form.locator('#ssh-section-connection .ssh-form-section-fields')).toHaveCSS('border-radius', '12px');
  await expect(form.getByTestId('ssh-forward-add')).toHaveCSS('border-radius', '8px');
  const quickCard = (await form.locator('#ssh-section-connection .ssh-form-section-fields').boundingBox())!;
  const quickGap = await form.evaluate((element) => {
    const sections = [...element.querySelectorAll<HTMLElement>('.ssh-form-section:not([hidden])')];
    return sections[1]!.getBoundingClientRect().top - sections[0]!.getBoundingClientRect().bottom;
  });
  for (const width of [1240, 640]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(form.getByTestId('ssh-form-host')).toBeVisible();
    const bounds = (await form.boundingBox())!;
    expect(bounds.width).toBeLessThanOrEqual(Math.min(760, width - 32));
    expect(Math.abs(bounds.x + bounds.width / 2 - width / 2)).toBeLessThan(2);
    await page.screenshot({ path: info.outputPath(`quick-connection-${width}.png`), animations: 'disabled' });
  }
  // The dialog matches the host editor page: same form column and the same section rhythm.
  await page.setViewportSize({ width: 1240, height: 800 });
  await page.keyboard.press('Escape');
  await page.getByTestId('ssh-new-btn').click();
  const editor = page.getByTestId('ssh-host-editor');
  const pageCard = (await editor.locator('#ssh-section-connection .ssh-form-section-fields').boundingBox())!;
  const pageGap = await editor.evaluate((element) => {
    const sections = [...element.querySelectorAll<HTMLElement>('.ssh-form-section:not([hidden])')];
    return sections[1]!.getBoundingClientRect().top - sections[0]!.getBoundingClientRect().bottom;
  });
  expect(Math.abs(quickCard.width - pageCard.width)).toBeLessThan(2);
  expect(Math.abs(quickGap - pageGap)).toBeLessThan(2);
});
