import { test, expect, type Locator, type Page } from '@playwright/test';
import { setupTauriMock, ensureChatSettingsOpen, themeConfig } from './tauri-mock';
import { gotoSetting } from './settings';

async function surfaceStyle(surface: Locator) {
  await expect(surface).toBeVisible();
  return surface.evaluate(el => {
    const style = getComputedStyle(el);
    const probe = document.createElement('div');
    probe.style.background = 'var(--menu-bg)';
    el.append(probe);
    const palette = getComputedStyle(probe);
    const result = {
      background: style.backgroundColor, expectedBackground: palette.backgroundColor,
      borderWidth: style.borderTopWidth,
      radius: style.borderRadius, shadow: style.boxShadow,
    };
    probe.remove();
    return result;
  });
}

async function assertSurface(surface: Locator, dialog = false) {
  const style = await surfaceStyle(surface);
  expect(style.background).toBe(style.expectedBackground);
  // Floating surfaces carry no ring: the shadow alone separates them from the page.
  expect(style.borderWidth).toBe('0px');
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
  await expect(selected).toHaveCSS('border-radius', '0px');
  const firstTitle = await selected.textContent();
  await dialog.getByPlaceholder('搜索文件、命令、设置…').press('ArrowDown');
  expect(await selected.textContent()).not.toBe(firstTitle);
  await page.screenshot({ path: test.info().outputPath('search.png') });
  await dialog.getByTestId('search-filter-button').click();
  await assertSurface(dialog.locator('.workspace-floating').last());
  await dialog.getByPlaceholder('搜索文件、命令、设置…').press('Escape');
  await expect(dialog.getByRole('menu')).toBeHidden();
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('搜索文件、命令、设置…').press('Escape');
  await expect(dialog).toBeHidden();
}

for (const theme of ['深色', '浅色']) {
  test(`dialogs, menus and pickers share the workspace surfaces in ${theme}`, async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await gotoSetting(page, '主题');
    await page.getByRole('radio', { name: theme, exact: true }).click();
    await page.keyboard.press('Meta+1');
    await search(page);

    await page.keyboard.press('Meta+p');
    const palette = page.getByRole('dialog', { name: '命令面板' });
    await assertSurface(palette, true);
    await palette.getByPlaceholder('搜索命令…').press('Escape');

    const splitTrigger = page.locator('[data-tip="选择类型分裂"]');
    const triggerBounds = (await splitTrigger.boundingBox())!;
    await splitTrigger.click();
    const newTab = page.getByRole('dialog', { name: '新建标签页' });
    await assertSurface(newTab);
    await expect(newTab).toHaveAttribute('aria-modal', 'false');
    const menuBounds = (await newTab.boundingBox())!;
    expect(menuBounds.y + menuBounds.height).toBeLessThanOrEqual(triggerBounds.y);
    await newTab.press('Escape');

    await page.locator('[data-dock-btn="ssh"]').click();
    await page.getByTestId('ssh-host-actions').click(); await page.getByRole('button', { name: '快速连接', exact: true }).click();
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
    await ensureChatSettingsOpen(page);
    await page.getByTestId('pill-name').first().click();
    const models = page.getByRole('dialog', { name: '选择模型' });
    await assertSurface(models, true);
    await models.getByPlaceholder('搜索模型…').fill('主力');
    await expect(models.getByTestId('model-pick-m-main')).toBeVisible();
    await models.getByTestId('model-pick-m-main').click();
    await expect(models).toBeHidden();
    await assertSurface(page.getByRole('status').filter({ hasText: '已切换到' }));
    await page.locator('[data-dock-btn="chat"]').click();
    await page.getByTestId('workspace-area-terminal').click();
    await page.getByRole('button', { name: '询问 AI', exact: true }).click();
    await ensureChatSettingsOpen(page);
    await page.getByRole('button', { name: '对话与审批模式' }).click();
    const modes = page.getByRole('listbox', { name: '对话与审批模式' });
    await assertSurface(modes);
    await page.getByRole('option', { name: /^纯聊天/ }).click();
    await expect(modes).toBeHidden();
  });
}

test('portaled menus and pickers mirror the application opacity', async ({ page }) => {
  await setupTauriMock(page);
  await page.addInitScript(() => {
    const target = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (cmd: string, args: Record<string, unknown>) => Promise<unknown> };
    };
    const original = target.__TAURI_INTERNALS__.invoke;
    target.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
      if (cmd === 'plugin:dialog|open') return '/wallpaper.png';
      if (cmd === 'read_image_data_url') {
        return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
      }
      return original(cmd, args);
    };
  });
  await page.goto('/');
  await gotoSetting(page, '主题');
  await page.getByRole('button', { name: '选择图片', exact: true }).click();
  await expect.poll(async () => (await themeConfig(page)).backgroundImage).toBe('/wallpaper.png');
  await page.locator('input[type="range"]').fill('0.6');
  await expect.poll(async () => (await themeConfig(page)).opacity).toBe(0.6);
  await expect(page.locator('.application-window')).toHaveCSS('opacity', '0.6');

  // A dropdown lives on the document body, so it mirrors the window opacity itself.
  await page.locator('aside').getByRole('button', { name: '字体与显示', exact: true }).click();
  await page.locator('.ui-select:visible').first().click();
  const picker = page.locator('.ui-select-menu');
  await expect(picker).toBeVisible();
  await expect(picker).toHaveCSS('opacity', '0.6');
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();

  await page.keyboard.press('Meta+1');
  await page.locator('[data-dock-btn="files"]').click();
  await page.getByText('notes.txt', { exact: true }).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: '操作菜单' });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveCSS('opacity', '0.6');
  await page.screenshot({ path: test.info().outputPath('translucent-menu.png') });

  // A dialog rendered inside the window keeps one opacity: the window already carries it.
  await menu.getByRole('button', { name: '删除', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '确认删除' });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toHaveCSS('opacity', '1');
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  await expect(confirmation).toBeHidden();
});
