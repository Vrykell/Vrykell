import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

test('interface, terminal and editor fonts load locally and keep mixed text aligned', async ({ page }) => {
  await setupTauriMock(page);
  const fonts: string[] = [];
  page.on('response', response => {
    if (response.url().includes('/fonts/') && response.url().endsWith('.woff2') && response.ok()) fonts.push(new URL(response.url()).pathname);
  });
  await page.goto('/');
  await gotoSetting(page, '字体与显示');
  expect(fonts.sort()).toEqual(['/fonts/terminal-alternate.woff2', '/fonts/terminal-bold.woff2', '/fonts/terminal-code.woff2', '/fonts/terminal-regular.woff2', '/fonts/ui-alternate.woff2', '/fonts/ui-sans.woff2']);
  const loaded = await page.evaluate(() => Array.from(document.fonts).map(face => ({ family: face.family.replaceAll('"', ''), status: face.status })));
  expect(loaded.filter(face => ['Noto Sans SC', 'Maple Mono NF CN'].includes(face.family))).toEqual([
    { family: 'Noto Sans SC', status: 'loaded' },
    { family: 'Maple Mono NF CN', status: 'loaded' },
    { family: 'Maple Mono NF CN', status: 'loaded' },
  ]);
  await expect(page.locator('body')).toHaveCSS('font-family', /"Noto Sans SC"/);
  const family = page.getByRole('combobox', { name: '终端字体', exact: true });
  await expect(family).toHaveText('Maple Mono NF CN');
  await expect(family).toHaveCSS('font-family', /"Noto Sans SC"/);
  await expect(page.getByLabel('终端字体预览')).toHaveCSS('font-family', /"Maple Mono NF CN"/);
  const widths = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    context.font = '14px "Maple Mono NF CN"';
    return ['A', 'W', '中', '\uf115', '\ue0a0'].map(text => context.measureText(text).width);
  });
  expect(widths[0]).toBeCloseTo(widths[1], 2);
  expect(widths[2]).toBeCloseTo(widths[0] * 2, 2);
  expect(widths[3]).toBeCloseTo(widths[0], 2);
  expect(widths[4]).toBeCloseTo(widths[0], 2);
  for (const width of [1240, 760]) {
    await page.setViewportSize({ width, height: 800 });
    await family.click();
    await expect(page.getByRole('option', { name: 'Maple Mono NF CN', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: 'JetBrains Mono', exact: true })).toBeAttached();
    await page.screenshot({ path: test.info().outputPath(`fonts-${width}.png`) });
    await page.keyboard.press('Escape');
  }
  await expect(page.getByRole('combobox', { name: '编辑器字体', exact: true })).toHaveText('Maple Mono NF CN');
  await expect(page.getByLabel('编辑器字体预览')).toHaveCSS('font-family', /"Maple Mono NF CN"/);
  const uiFamily = page.getByRole('combobox', { name: '页面字体', exact: true });
  await uiFamily.click();
  await page.getByRole('option', { name: 'Inter', exact: true }).click();
  await expect(page.locator('body')).toHaveCSS('font-family', /^Inter,/);
  await page.getByRole('combobox', { name: '编辑器字体', exact: true }).click();
  await page.getByRole('option', { name: 'JetBrains Mono', exact: true }).click();
  await page.reload();
  await gotoSetting(page, '字体与显示');
  await expect(uiFamily).toHaveText('Inter');
  await expect(page.getByRole('combobox', { name: '编辑器字体', exact: true })).toHaveText('JetBrains Mono');
  await expect(page.getByRole('combobox', { name: '终端字体', exact: true })).toHaveText('Maple Mono NF CN');
  await gotoSetting(page, '编辑器设置');
  await expect(page.getByRole('combobox', { name: '编辑器字体', exact: true })).toHaveCount(0);
});

test('missing font assets retain a usable application with fallback fonts', async ({ page }) => {
  await setupTauriMock(page);
  await page.route('**/fonts/*.woff2', route => route.abort());
  await page.goto('/');
  await gotoSetting(page, '字体与显示');
  await expect(page.getByRole('combobox', { name: '终端字体', exact: true })).toBeVisible();
});

test('native font defaults are selectable and persist independently', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await gotoSetting(page, '字体与显示');
  for (const name of ['页面字体', '终端字体', '编辑器字体']) {
    const family = page.getByRole('combobox', { name, exact: true });
    await family.click();
    await family.press('Home');
    await family.press('Enter');
    await expect(family).toHaveText('系统默认字体');
  }
  await expect(page.locator('body')).toHaveCSS('font-family', /^system-ui,/);
  await expect(page.getByLabel('终端字体预览')).toHaveCSS('font-family', /^monospace,/);
  await expect(page.getByLabel('编辑器字体预览')).toHaveCSS('font-family', /^monospace,/);
  await page.reload();
  await gotoSetting(page, '字体与显示');
  for (const name of ['页面字体', '终端字体', '编辑器字体']) {
    await expect(page.getByRole('combobox', { name, exact: true })).toHaveText('系统默认字体');
  }
  const uiFamily = page.getByRole('combobox', { name: '页面字体', exact: true });
  await uiFamily.click();
  await expect(page.getByRole('option', { name: 'Cascadia Code', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'JetBrains Mono', exact: true })).toBeVisible();
  await page.getByRole('option', { name: 'Maple Mono NF CN', exact: true }).click();
  await expect(page.locator('body')).toHaveCSS('font-family', /^"Maple Mono NF CN",/);
  await expect(page.getByRole('combobox', { name: '终端字体', exact: true })).toHaveText('系统默认字体');
  await expect(page.getByRole('combobox', { name: '编辑器字体', exact: true })).toHaveText('系统默认字体');
});

test('the mounted editor uses the bundled text face and interface face', async ({ page }) => {
  await setupTauriMock(page.context(), { launchDirectory: '/home/e2e/project', terminalDirectories: true });
  await page.goto('/');
  await page.getByRole('button', { name: '版本控制', exact: true }).click();
  const row = page.getByTestId('git-unstaged-src/main.ts');
  await row.hover();
  await row.getByRole('button', { name: '打开工作文件' }).click();
  const editor = page.getByTestId('file-editor');
  await expect(editor.locator('.monaco-editor')).toBeVisible({ timeout: 15_000 });
  await expect(editor.locator('.monaco-editor')).toHaveCSS('font-family', /"Noto Sans SC"/);
  await expect(editor.locator('.view-lines')).toHaveCSS('font-family', /"Maple Mono NF CN"/);
  await editor.locator('textarea.inputarea').focus();
  await page.keyboard.press('Control+f');
  await expect(editor.locator('.find-widget')).toBeVisible();
  await expect(editor.locator('.find-widget .monaco-inputbox').first()).toHaveCSS('font-family', /"Noto Sans SC"/);
});
