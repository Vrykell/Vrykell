import { expect, test } from '@playwright/test';
import { setupTauriMock, ensureTabsOpen } from './tauri-mock';

test.describe('新建标签类型快捷配置', () => {
  test('restored default shell icons follow the resolved default and nested settings stay on screen', async ({ page }, info) => {
    await ensureTabsOpen(page);
    const restored = page.locator('[data-tab-kind="session"]').first().locator('[role="tab"] svg');
    await expect(restored).toHaveAttribute('data-shell-mark', 'zsh');
    await page.getByTestId('tab-new-btn').click();
    await page.getByTestId('new-tab-option-shell:bash').click({ button: 'right' });
    const settings = page.getByRole('menuitem', { name: '打开方式', exact: true });
    await settings.press('ArrowRight');
    await expect(page.getByRole('menuitemradio', { name: '经典模式' })).toBeFocused();
    for (const width of [1240, 600]) {
      await page.setViewportSize({ width, height: 800 });
      for (const menu of await page.getByRole('menu').all()) {
        // Menus reposition on resize; poll until the new placement settles.
        await expect.poll(async () => {
          const bounds = (await menu.boundingBox())!;
          return bounds.x >= 8 && bounds.x + bounds.width <= width - 8;
        }, { message: `menu stays on screen at ${width}px` }).toBe(true);
      }
      await page.screenshot({ path: info.outputPath(`nested-settings-${width}.png`) });
    }
    await page.keyboard.press('ArrowLeft');
    await expect(settings).toBeFocused();
    await page.getByRole('menuitemradio', { name: '设为默认终端' }).click();
    await expect(restored).toHaveAttribute('data-shell-mark', 'bash');
    await page.reload(); await ensureTabsOpen(page);
    await expect(restored).toHaveAttribute('data-shell-mark', 'bash');
    await page.screenshot({ path: info.outputPath('restored-default-color.png') });
  });
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await ensureTabsOpen(page);
  });

  test('右击终端类型切换打开模式并影响新标签', async ({ page }) => {
    await page.getByTestId('tab-new-btn').click();
    const zsh = page.getByTestId('new-tab-option-shell:zsh');
    await expect(zsh).toBeVisible();

    await zsh.click({ button: 'right' });
    const menu = page.getByRole('menu', { name: '操作菜单' });
    await menu.getByRole('menuitem', { name: '打开方式', exact: true }).click();
    await expect(page.getByRole('menuitemradio', { name: '经典模式' })).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('menuitemradio', { name: '经典模式' }).click();
    await expect(page.getByRole('menu', { name: '操作菜单' })).toHaveCount(0);

    // 重新打开菜单，选中项已切换
    await zsh.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '打开方式', exact: true }).click();
    await expect(page.getByRole('menuitemradio', { name: '经典模式' })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu', { name: '操作菜单' })).toHaveCount(0);

    // 使用该类型新建的标签按新模式启动
    await zsh.click();
    await expect(page.locator('[data-testid^="tab-row-"]')).toHaveCount(2);
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { __PTY_SPAWNS__: { shell?: string; openMode?: string }[] }).__PTY_SPAWNS__
        .some(spawn => spawn.shell === 'zsh' && spawn.openMode === 'classic'),
    )).toBe(true);
  });

  test('右击终端类型设为默认终端', async ({ page }) => {
    await page.getByTestId('tab-new-btn').click();
    await page.getByTestId('new-tab-option-shell:bash').click({ button: 'right' });
    await page.getByRole('menuitemradio', { name: '设为默认终端' }).click();

    await expect(page.getByTestId('new-tab-option-shell:bash').getByText('默认终端')).toBeVisible();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('vrykell-terminal-defaults') ?? '{}'));
    expect(stored.state.shell).toBe('bash');
  });

  test('右击 SSH 连接切换快捷开关并打开编辑弹窗', async ({ page }) => {
    await page.getByTestId('tab-new-btn').click();
    const row = page.getByTestId('new-tab-option-ssh:ssh-1');
    await expect(row).toBeVisible();

    await row.click({ button: 'right' });
    const menu = page.getByRole('menu', { name: '操作菜单' });
    await menu.getByRole('menuitem', { name: '打开方式', exact: true }).click();
    await expect(page.getByRole('menuitemradio', { name: '经典模式' })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('menuitemradio', { name: 'Shell 集成' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('menuitemradio', { name: '自动重连' }).click();

    // 保存完成后再打开菜单，勾选状态已更新
    await expect.poll(async () => {
      await row.click({ button: 'right' });
      return page.getByRole('menuitemradio', { name: '自动重连' }).getAttribute('aria-checked');
    }).toBe('true');
    await page.keyboard.press('Escape');

    // 编辑连接打开 SSH 表单，关闭后回到选择器
    await row.click({ button: 'right' });
    await page.getByText('编辑连接').click();
    const form = page.getByRole('dialog', { name: 'SSH 连接' });
    await expect(form).toBeVisible();
    await expect(form.getByText('编辑 SSH 连接')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(form).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: '新建标签页' })).toBeVisible();
  });

  test('右击 SSH 连接删除需二次确认', async ({ page }) => {
    await page.getByTestId('tab-new-btn').click();
    await page.getByTestId('new-tab-option-ssh:ssh-1').click({ button: 'right' });
    await page.getByText('删除连接').click();

    const confirm = page.getByRole('dialog', { name: '删除 SSH 连接？' });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByText('生产服务器')).toBeVisible();
    await confirm.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('new-tab-option-ssh:ssh-1')).toHaveCount(0);
  });
});
