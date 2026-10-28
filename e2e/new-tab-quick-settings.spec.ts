import { expect, test } from '@playwright/test';
import { setupTauriMock, ensureTabsOpen } from './tauri-mock';

test.describe('new tab type quick settings', () => {
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
  test.beforeEach(async ({ page }, info) => {
    await setupTauriMock(page);
    if (info.title.startsWith('restored default shell')) await page.addInitScript(() => {
      const api = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
      const original = api.invoke;
      api.invoke = async (command, args) => {
        const result = await original(command, args);
        if (command !== 'list_sessions' && command !== 'get_session') return result;
        const update = (row: { id: string; payload: string }) => {
          if (row.id !== 't1') return row;
          const payload = JSON.parse(row.payload) as { layout: { terminal: { shellType?: string } } };
          delete payload.layout.terminal.shellType;
          return { ...row, payload: JSON.stringify(payload) };
        };
        return Array.isArray(result) ? result.map(update) : result ? update(result as { id: string; payload: string }) : result;
      };
    });
    await page.goto('/');
    await ensureTabsOpen(page);
  });

  test('right-clicking a terminal type switches the open mode and affects new tabs', async ({ page }) => {
    await page.getByTestId('tab-new-btn').click();
    const zsh = page.getByTestId('new-tab-option-shell:zsh');
    await expect(zsh).toBeVisible();

    await zsh.click({ button: 'right' });
    const menu = page.getByRole('menu', { name: '操作菜单' });
    await menu.getByRole('menuitem', { name: '打开方式', exact: true }).click();
    await expect(page.getByRole('menuitemradio', { name: '经典模式' })).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('menuitemradio', { name: '经典模式' }).click();
    await expect(page.getByRole('menu', { name: '操作菜单' })).toHaveCount(0);

    // Reopen the menu; the selected item has switched
    await zsh.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '打开方式', exact: true }).click();
    await expect(page.getByRole('menuitemradio', { name: '经典模式' })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu', { name: '操作菜单' })).toHaveCount(0);

    // A tab created with this type starts in the new mode
    await zsh.click();
    await expect(page.locator('[data-testid^="tab-row-"]')).toHaveCount(2);
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { __PTY_SPAWNS__: { shell?: string; openMode?: string }[] }).__PTY_SPAWNS__
        .some(spawn => spawn.shell === 'zsh' && spawn.openMode === 'classic'),
    )).toBe(true);
  });

  test('right-clicking a terminal type sets it as the default terminal', async ({ page }) => {
    await page.getByTestId('tab-new-btn').click();
    await page.getByTestId('new-tab-option-shell:bash').click({ button: 'right' });
    await page.getByRole('menuitemradio', { name: '设为默认终端' }).click();

    await expect(page.getByTestId('new-tab-option-shell:bash').locator('[aria-label="默认终端"]')).toBeVisible();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('vrykell-terminal-defaults') ?? '{}'));
    expect(stored.state.shell).toBe('bash');
  });

  test('right-clicking an SSH connection toggles a quick switch and opens the edit dialog', async ({ page }) => {
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

    // Reopen the menu after the save completes; the checked state is updated
    await expect.poll(async () => {
      await row.click({ button: 'right' });
      return page.getByRole('menuitemradio', { name: '自动重连' }).getAttribute('aria-checked');
    }).toBe('true');
    await page.keyboard.press('Escape');

    // Edit connection opens the SSH form; closing it returns to the picker
    await row.click({ button: 'right' });
    await page.getByText('编辑连接').click();
    const form = page.getByTestId('ssh-host-editor');
    await expect(form).toBeVisible();
    await expect(form.getByTestId('ssh-form-name')).toHaveValue('生产服务器');
    await form.getByRole('button', { name: '取消', exact: true }).click();
    await expect(form).toHaveCount(0);
    await expect(page.getByTestId('ssh-workspace')).toBeVisible();
  });

  test('deleting an SSH connection from its right-click menu requires confirmation', async ({ page }) => {
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
