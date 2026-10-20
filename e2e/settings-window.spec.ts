import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

test('settings cover the content card and toggle back to the unchanged workspace', async ({ page }, info) => {
  await setupTauriMock(page);
  await page.goto('/');
  const input = page.locator('[data-terminal-input]').first();
  await expect(input).toBeVisible();
  await input.fill('keep this command draft');
  const rail = page.locator('.workspace-activity-bar');
  const railBefore = await rail.boundingBox();
  expect(railBefore!.width).toBe(40);
  const verifyButtonCenters = async () => {
    const bounds = (await rail.boundingBox())!;
    for (const button of await rail.getByRole('button').all()) {
      const box = (await button.boundingBox())!;
      expect(box.x + box.width / 2).toBe(bounds.x + bounds.width / 2);
    }
  };
  await verifyButtonCenters();
  const cardLeft = (await page.locator('.workspace-side-panel[data-side="left"][data-visible="true"]').boundingBox())!.x;
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const settings = page.getByRole('region', { name: '设置', exact: true });
  for (const width of [1240, 720]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(settings).toBeVisible();
    expect((await rail.boundingBox())!.width).toBe(railBefore!.width);
    await verifyButtonCenters();
    expect((await settings.boundingBox())!.x).toBe(cardLeft);
    expect(await settings.boundingBox()).toEqual({ x: 40, y: 42, width: width - 48, height: 750 });
    const close = settings.getByRole('button', { name: '关闭设置', exact: true });
    await expect(close).toBeVisible();
    await expect(close).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await close.hover();
    await expect(close).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await close.focus();
    await expect(close).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(settings.locator('.settings-navigation')).toBeVisible();
    await expect(settings.locator('.settings-navigation-toggle')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`settings-${width}.png`) });
  }
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(settings).toHaveCount(0);
  await expect(input).toHaveValue('keep this command draft');
  await page.setViewportSize({ width: 1240, height: 800 });
  await page.locator('[data-dock-btn="chat"]').click();
  await expect(page.locator('.workspace-side-panel[data-side="left"][data-visible="true"]')).toBeVisible();
  await expect(page.locator('.workspace-side-panel[data-side="right"][data-visible="true"]')).toBeVisible();
  const sampledColors = await page.locator('html').evaluate(element => {
    const style = getComputedStyle(element);
    return ['--canvas', '--sidebar-bg', '--xterm-bg', '--surface', '--field-bg', '--primary-action'].map(name => style.getPropertyValue(name).trim().toUpperCase());
  });
  expect(sampledColors).toEqual(['#202020', '#1C1C1C', '#141414', '#282828', '#2C2C2C', '#183C57']);
  const chrome = await page.locator('.application-chrome').evaluate(element => {
    const style = getComputedStyle(element);
    return {
      color: style.backgroundColor,
      background: style.backgroundImage,
    };
  });
  expect(chrome).toEqual({ color: 'rgba(0, 0, 0, 0.6)', background: 'none' });
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('.workspace-titlebar')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.screenshot({ path: info.outputPath('sampled-palette-workspace.png') });
  expect((await rail.boundingBox())!.width).toBe(railBefore!.width);
  await page.keyboard.press('Control+,');
  await expect(settings).toBeVisible();
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await expect(input).toBeVisible();
  await page.keyboard.press('Control+,');
  await page.keyboard.press('Escape');
  await expect(input).toBeVisible();
  await expect(input).toHaveValue('keep this command draft');
});

test('language and appearance choices apply immediately and persist', async ({ page }, info) => {
  await setupTauriMock(page); await page.goto('/');
  await gotoSetting(page, '语言');
  await page.getByRole('combobox', { name: '界面语言', exact: true }).click();
  await page.getByRole('option', { name: 'English', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close settings', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.locator('.settings-navigation').getByRole('button', { name: 'Theme', exact: true }).click();
  const modes = page.getByRole('radiogroup', { name: 'Theme mode', exact: true });
  await expect(modes.locator('.theme-mode-preview')).toHaveCount(3);
  const selectedPreview = modes.getByRole('radio', { checked: true }).locator('.theme-mode-preview');
  await expect(selectedPreview).toHaveCSS('border-top-width', '3px');
  await expect(selectedPreview).toHaveCSS('outline-style', 'none');
  await modes.getByRole('radio', { name: 'Light', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const tint = page.getByRole('switch', { name: 'Desktop material', exact: true });
  await tint.click();
  await expect(tint).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('.application-window')).toHaveAttribute('data-desktop-tint', 'false');
  await expect(page.locator('.application-chrome')).toHaveCSS('background-color', 'rgb(233, 240, 250)');
  await page.screenshot({ path: info.outputPath('appearance-light.png') });
  await modes.getByRole('radio', { name: 'Dark', exact: true }).click();
  await page.screenshot({ path: info.outputPath('appearance-dark.png') });
  await modes.getByRole('radio', { name: 'Follow system', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('.settings-navigation').getByRole('button', { name: 'Language', exact: true }).click();
  await page.getByRole('combobox', { name: 'Application language', exact: true }).click();
  await page.getByRole('option', { name: 'Follow system', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('wallpaper mode darkens the sidebar backdrop while preserving the UI layout', async ({ page }, info) => {
  await setupTauriMock(page);
  await page.goto('/');
  await gotoSetting(page, '主题');
  await page.evaluate(async () => {
    const path = '/src/features/settings/model/terminalTheme.ts';
    const { useTerminalThemeStore } = await import(path) as typeof import('../src/features/settings/model/terminalTheme');
    const wallpaper = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#ffd8ee"/></svg>';
    useTerminalThemeStore.setState(state => ({
      wallpaperDataUrl: `data:image/svg+xml;base64,${btoa(wallpaper)}`,
      config: { ...state.config, opacity: 0.7 },
    }));
  });
  const window = page.locator('.application-window');
  await expect(window).toHaveAttribute('data-wallpaper', 'true');
  await expect(page.locator('.settings-navigation')).toHaveCSS('backdrop-filter', 'brightness(0.55) saturate(0.88)');
  await expect(page.locator('.settings-navigation')).toBeVisible();
  await page.screenshot({ path: info.outputPath('wallpaper-sidebar-mask.png') });
});
