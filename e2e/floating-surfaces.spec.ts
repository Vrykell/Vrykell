import { test, expect, type Locator, type Page } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

async function surfaceStyle(surface: Locator) {
  await expect(surface).toBeVisible();
  return surface.evaluate(el => {
    const style = getComputedStyle(el);
    const probe = document.createElement('div');
    probe.style.background = 'var(--surface)';
    probe.style.border = '1px solid var(--border)';
    el.append(probe);
    const palette = getComputedStyle(probe);
    const result = {
      background: style.backgroundColor, expectedBackground: palette.backgroundColor,
      border: style.borderColor, expectedBorder: palette.borderColor,
      radius: style.borderRadius, shadow: style.boxShadow,
    };
    probe.remove();
    return result;
  });
}

async function assertSurface(surface: Locator, dialog = false) {
  const style = await surfaceStyle(surface);
  expect(style.background).toBe(style.expectedBackground);
  expect(style.border).toBe(style.expectedBorder);
  expect(style.radius).toBe(dialog ? '14px' : '10px');
  expect(style.shadow).not.toBe('none');
}

async function search(page: Page) {
  await page.getByTestId('global-search-trigger').click();
  const dialog = page.getByRole('dialog', { name: '全局搜索' });
  await assertSurface(dialog, true);
  await dialog.getByPlaceholder('搜索文件、命令、设置…').fill('npm');
  const results = dialog.locator('[data-search-result]');
  await expect(results.first()).toBeVisible();
  const selected = dialog.locator('[data-search-result][data-selected="true"]');
  await expect(selected).toHaveCSS('border-left-width', '0px');
  await expect(selected).toHaveCSS('border-radius', '8px');
  const firstTitle = await selected.textContent();
  await dialog.getByPlaceholder('搜索文件、命令、设置…').press('ArrowDown');
  expect(await selected.textContent()).not.toBe(firstTitle);
  await page.screenshot({ path: test.info().outputPath('search.png') });
  await dialog.getByTestId('search-filter-button').click();
  await assertSurface(dialog.locator('.workspace-floating').last());
  await dialog.getByPlaceholder('搜索文件、命令、设置…').press('Escape');
  await expect(dialog).toBeHidden();
}

for (const theme of ['深色', '浅色']) {
  test(`dialogs, menus and pickers share the workspace surfaces in ${theme}`, async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await gotoSetting(page, '主题');
    await page.getByRole('button', { name: theme, exact: true }).click();
    await page.keyboard.press('Meta+1');
    await search(page);

    await page.keyboard.press('Meta+p');
    const palette = page.getByRole('dialog', { name: '命令面板' });
    await assertSurface(palette, true);
    await palette.getByPlaceholder('搜索命令…').press('Escape');

    await page.getByTitle('选择类型分裂', { exact: true }).click();
    const newTab = page.getByRole('dialog', { name: '新建标签页' });
    await assertSurface(newTab, true);
    await newTab.getByPlaceholder('搜索标签页类型…').press('Escape');

    await page.locator('[data-dock-btn="ssh"]').click();
    await page.getByTestId('ssh-new-btn').click();
    const sshForm = page.getByRole('dialog', { name: 'SSH 连接' });
    await assertSurface(sshForm, true);
    await sshForm.getByRole('button', { name: '取消', exact: true }).click();

    await page.locator('[data-dock-btn="files"]').click();
    await page.getByText('notes.txt', { exact: true }).click({ button: 'right' });
    const menu = page.getByRole('menu', { name: '操作菜单' });
    await assertSurface(menu);
    await menu.getByRole('button', { name: '删除', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: '确认删除' });
    await assertSurface(confirmation, true);
    await confirmation.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByText('notes.txt', { exact: true })).toBeVisible();

    await page.locator('[data-dock-btn="chat"]').click();
    await page.getByTestId('pill-name').first().click();
    const models = page.getByRole('dialog', { name: '选择模型' });
    await assertSurface(models, true);
    await models.getByPlaceholder('搜索模型…').fill('主力');
    await expect(models.getByTestId('model-pick-m-main')).toBeVisible();
    await models.getByTestId('model-pick-m-main').click();
    await expect(models).toBeHidden();
    await assertSurface(page.getByRole('status').filter({ hasText: '已切换到' }));
    await page.getByTestId('pill-level').first().click();
    await assertSurface(page.getByTestId('think-level-menu'));
    await page.getByTestId('think-option-high').click();
    await expect(page.getByTestId('think-level-menu')).toBeHidden();
  });
}
