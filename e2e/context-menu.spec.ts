import { test, expect } from '@playwright/test';
import { setupTauriMock, forwardLaunchDirectory } from './tauri-mock';
import { gotoSetting } from './settings';

test('settings require certificate trust and manage registration explicitly', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await gotoSetting(page, 'Windows 右键菜单');
  const enable = page.getByRole('button', { name: '启用右键菜单' });
  await expect(enable).toBeDisabled();
  await page.getByRole('button', { name: '信任此证书' }).click();
  await expect(enable).toBeEnabled();
  await enable.click();
  await expect(page.getByRole('button', { name: '移除证书信任' })).toBeDisabled();
  await page.getByRole('button', { name: '停用右键菜单' }).click();
  await page.getByRole('button', { name: '移除证书信任' }).click();
  await expect(enable).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as { __MENU_ACTIONS__: string[] }).__MENU_ACTIONS__)).toEqual(['trust', 'enable', 'disable', 'untrust']);
});

test('a shell launch opens exactly one terminal at the requested path even with empty startup mode', async ({ page }) => {
  const cwd = 'C:\\Work space\\项目 & notes';
  await setupTauriMock(page, { launchDirectory: cwd });
  await page.addInitScript(() => localStorage.setItem('vrykell-startup-mode', 'empty'));
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __PTY_SPAWNS__: { cwd?: string }[] }).__PTY_SPAWNS__.some(spawn => spawn.cwd === 'C:\\Work space\\项目 & notes'))).toBe(true);
  expect(await page.evaluate(async () => {
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    return useWorkspaceStore.getState().tabs.filter(tab => tab.kind === 'session').length;
  })).toBe(1);
});

test('a shell launch forwarded to the running window opens a tab instead of a second window', async ({ page }) => {
  const cwd = 'C:\\转发 & notes\\项目';
  await setupTauriMock(page);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __PTY_SPAWNS__: { cwd?: string }[] }).__PTY_SPAWNS__.length)).toBeGreaterThan(0);

  await forwardLaunchDirectory(page, cwd);

  await expect.poll(() => page.evaluate(() => (window as unknown as { __PTY_SPAWNS__: { cwd?: string }[] }).__PTY_SPAWNS__.some(spawn => spawn.cwd === 'C:\\转发 & notes\\项目'))).toBe(true);
  expect(await page.evaluate(async () => {
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    return useWorkspaceStore.getState().tabs.filter(tab => tab.kind === 'session').length;
  })).toBe(2);
});

test('a launch forwarded before the window listened still opens its tab', async ({ page }) => {
  await setupTauriMock(page, { pendingLaunchDirectories: ['C:\\early'] });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __PTY_SPAWNS__: { cwd?: string }[] }).__PTY_SPAWNS__.some(spawn => spawn.cwd === 'C:\\early'))).toBe(true);
});

test('Windows leaves corner clipping to the compositor and fills the control edges', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  const root = page.locator('.application-window');
  await root.evaluate(element => element.setAttribute('data-platform', 'windows'));
  await expect(root).toHaveCSS('border-top-right-radius', '0px');
  expect(await root.evaluate(element => getComputedStyle(element, '::after').display)).toBe('none');
  await page.getByTestId('window-close').hover();
  expect(await page.getByTestId('window-close').evaluate(element => element.contains(document.elementFromPoint(window.innerWidth - 1, 0)))).toBe(true);
  await page.screenshot({ path: test.info().outputPath('window-corner.png'), clip: { x: 1160, y: 0, width: 80, height: 80 } });
  await page.getByTestId('window-controls').evaluate(element => element.setAttribute('data-window-maximized', 'true'));
  await expect(root).toHaveCSS('border-top-right-radius', '0px');
  expect(await root.evaluate(element => getComputedStyle(element, '::after').display)).toBe('none');
});
