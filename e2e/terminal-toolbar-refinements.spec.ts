import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

for (const theme of ['dark', 'light']) test(`terminal split creation and group menu remain usable in ${theme}`, async ({ page }, info) => {
  await setupTauriMock(page, {});
  await page.addInitScript(theme => {
    localStorage.setItem('vrykell-theme-mode', theme);
    localStorage.setItem('vrykell-terminal-defaults', JSON.stringify({ state: { shell: 'bash' }, version: 0 }));
  }, theme);
  await page.goto('/');
  await expect(page.locator('[data-tab-row-id]')).toHaveCount(1);
  await page.getByTestId('tab-new-default').click();
  await expect(page.getByRole('dialog', { name: '新建标签页' })).toHaveCount(0);
  await expect(page.locator('[data-tab-row-id]')).toHaveCount(2);
  const added = page.locator('[data-tab-row-id]').last();
  await expect(added.locator('[data-shell-mark="bash"]')).toBeVisible();
  await expect(added).toHaveAttribute('data-tab-group', '');
  await page.getByTestId('tab-new-btn').click();
  const picker = page.getByRole('dialog', { name: '新建标签页' });
  await expect(picker.getByTestId('new-tab-option-shell:zsh')).toBeVisible();
  await expect(picker.getByTestId('new-tab-option-ssh:ssh-1')).toBeVisible();
  await page.keyboard.press('Escape');
  await added.click({ button: 'right' });
  await page.getByRole('button', { name: '新建分组', exact: true }).click();
  const name = page.getByRole('textbox', { name: '分组名称' });
  await expect(name).toBeFocused();
  await name.fill('Production'); await name.press('Enter');
  const header = page.getByRole('button', { name: 'Production', exact: true });
  await expect(header.locator('xpath=../..')).toHaveAttribute('data-group-card', 'true');
  await header.dblclick();
  await expect(header.locator('input')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '分组名称' })).toHaveCount(0);
  await header.click({ button: 'right' }); await name.fill('Cancelled'); await name.press('Escape');
  await expect(header).toHaveText('Production');
  await header.click({ button: 'right' }); await name.fill('Services');
  await page.locator('[data-terminal-input]:visible').click();
  await expect(page.getByRole('button', { name: 'Services', exact: true })).toBeVisible();
  for (const width of [1240, 760]) {
    await page.setViewportSize({ width, height: 800 });
    await page.getByRole('button', { name: '更多终端操作', exact: true }).click();
    const menu = page.getByRole('menu', { name: '更多终端操作' });
    await expect(menu.getByRole('menuitem', { name: '会话历史', exact: true })).toBeVisible();
    await menu.getByRole('menuitem', { name: '搜索会话…', exact: true }).click();
    const search = page.getByTestId('tab-search');
    await expect(search).toHaveClass(/text-input-field/);
    await expect(search).toHaveCSS('border-radius', '8px');
    expect((await search.boundingBox())!.width).toBeLessThan(160);
    await search.fill('missing terminal');
    await expect(page.getByText('无匹配会话', { exact: true })).toBeVisible();
    await search.fill('');
    await page.screenshot({ path: info.outputPath(`terminal-controls-${theme}-${width}.png`), animations: 'disabled' });
  }
});
