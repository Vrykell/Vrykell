import { expect, test } from '@playwright/test';
import { setupTauriMock, waitForWorkbench } from './tauri-mock';

for (const width of [900, 1440])
  test(`shared window menu at ${width}px`, async ({ page }, info) => {
    await setupTauriMock(page);
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    await waitForWorkbench(page);
    const title = page.locator('.workspace-title');
    const menu = page.getByRole('menu', { name: '窗口操作' });
    const openMenu = () => title.click({ button: 'right', position: { x: 4, y: 20 } });
    await openMenu();
    await expect(menu).toHaveClass(/context-menu-surface/);
    await expect(menu.getByRole('menuitem', { name: '还原窗口' })).toBeDisabled();
    await expect(menu.getByRole('menuitem', { name: '移动窗口' })).toBeEnabled();
    await expect(menu.getByRole('menuitem', { name: '调整窗口大小' })).toBeEnabled();
    await expect(menu.getByRole('menuitem', { name: /关闭窗口/ })).toContainText('F4');
    await menu.screenshot({ path: info.outputPath(`window-menu-${width}.png`) });
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await openMenu();
    await menu.getByRole('menuitemradio', { name: '置于顶层' }).click();
    await openMenu();
    await expect(menu.getByRole('menuitemradio', { name: '置于顶层' })).toHaveAttribute('aria-checked', 'true');
    await menu.getByRole('menuitem', { name: '最大化窗口' }).click();
    await openMenu();
    await expect(menu.getByRole('menuitem', { name: '还原窗口' })).toBeEnabled();
    await expect(menu.getByRole('menuitem', { name: '移动窗口' })).toBeDisabled();
    await menu.getByRole('menuitem', { name: '还原窗口' }).click();
  });
