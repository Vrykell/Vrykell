import { expect, test, type Page } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

test.setTimeout(60_000);
test.beforeEach(async ({ page }) => {
  await setupTauriMock(page, {});
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('workspace-area-code').click();
  await page.getByTestId('code-start-page-content').getByRole('button', { name: '新建文件', exact: true }).click();
  await expect(page.getByTestId('file-editor').locator('.monaco-editor')).toBeVisible({ timeout: 20_000 });
});

async function action(page: Page, label: string) {
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: '更多编辑器操作' }).click();
  await page.getByRole('menu', { name: '更多编辑器操作' }).locator('button').filter({ hasText: label }).click();
}
async function source(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/features/editor/stores/documents.ts';
    const { useEditorDocuments } = await import(path) as typeof import('../src/features/editor/stores/documents');
    return Object.values(useEditorDocuments.getState().documents)[0]?.value.replace(/\r\n/g, '\n');
  });
}

test('opens actual lines with modal o and O and supports numeric line jumps', async ({ page }, info) => {
  const editor = page.getByTestId('file-editor');
  await editor.locator('textarea.inputarea').focus(); await page.keyboard.insertText('first\nsecond\nthird');
  await action(page, 'Vim 模式');
  await expect(editor.locator('.code-editor-vim-status')).toContainText('NORMAL');
  await expect(editor.getByTestId('editor-file-path')).toHaveText('未命名 1.txt');
  await expect(editor.locator('.code-editor-status')).toContainText('未保存');
  await editor.locator('textarea.inputarea').focus(); await page.keyboard.type('ggo');
  await expect(editor.locator('.code-editor-vim-status')).toContainText('INSERT');
  await page.keyboard.insertText('below'); await page.keyboard.press('Escape');
  await expect.poll(() => source(page)).toBe('first\nbelow\nsecond\nthird');
  await page.keyboard.type('gg'); await expect(editor.locator('.code-editor-cursor')).toContainText('第 1 行');
  await page.keyboard.press('O'); await page.keyboard.insertText('above'); await page.keyboard.press('Escape');
  await expect.poll(() => source(page)).toBe('above\nfirst\nbelow\nsecond\nthird');
  await page.keyboard.type(':4'); await page.keyboard.press('Enter');
  await expect(editor.locator('.code-editor-cursor')).toContainText('第 4 行');
  await page.keyboard.type('2G');
  await expect(editor.locator('.code-editor-cursor')).toContainText('第 2 行');
  await expect(editor.locator('.view-lines')).toContainText('above');
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: '更多编辑器操作' }).click();
  const menu = page.getByRole('menu', { name: '更多编辑器操作' });
  const lefts = await menu.locator('[data-menu-label]').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().x));
  expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThanOrEqual(1);
  const selected = menu.getByRole('menuitemradio', { name: 'Vim 模式', exact: true });
  const bounds = (await selected.boundingBox())!; const check = (await selected.locator('[data-check-slot]').boundingBox())!;
  expect(bounds.x + bounds.width - check.x - check.width).toBeCloseTo(12, 0);
  await page.screenshot({ path: info.outputPath('editor-menu-shared.png'), animations: 'disabled' });
});

test('shares editor preferences, keeps independent metrics and centers a symmetric find strip', async ({ page }, info) => {
  const editor = page.getByTestId('file-editor');
  await editor.locator('textarea.inputarea').focus(); await page.keyboard.insertText('retained text\nsecond line');
  await expect(editor.locator('.line-numbers').first()).toBeVisible();
  await gotoSetting(page, '编辑器设置');
  await page.getByRole('switch', { name: '显示行号' }).click();
  await gotoSetting(page, '字体与显示');
  for (const [name, option] of [['编辑器字号', '18px'], ['编辑器字重', '550'], ['编辑器行距', '1.8×']]) {
    await page.getByRole('combobox', { name }).click(); await page.getByRole('option', { name: option, exact: true }).click();
  }
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('vrykell-typography')!).state);
  expect(saved).toMatchObject({ editorFontSize: 18, editorFontWeight: 550, editorLineHeight: 1.8, terminalFontSize: 14, chatFontSize: 14 });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(editor.locator('.view-lines')).toContainText('retained text');
  await expect(editor.locator('.line-numbers')).toHaveCount(0);
  await expect(editor.locator('.view-lines')).toHaveCSS('font-size', '18px');
  await action(page, '查找');
  const find = editor.locator('.find-widget');
  await expect(find).toHaveClass(/visible/);
  const radii = await find.evaluate(element => { const style = getComputedStyle(element); return [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius, style.borderBottomRightRadius]; });
  expect(new Set(radii).size).toBe(1); expect(parseFloat(radii[0])).toBeGreaterThan(0);
  for (const width of [1240, 760]) {
    await page.setViewportSize({ width, height: 800 });
    await expect.poll(() => find.evaluate(element => {
      const bounds = element.getBoundingClientRect(); const close = element.querySelector('.codicon-widget-close')!.getBoundingClientRect();
      return Math.abs(bounds.y + bounds.height / 2 - close.y - close.height / 2);
    })).toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath(`editor-find-${width}.png`), animations: 'disabled' });
  }
});

test('isolates a compact menu slot and keeps create actions at the far right', async ({ page }, info) => {
  for (const area of ['terminal', 'code', 'ai']) {
    await page.getByTestId(`workspace-area-${area}`).click();
    const bar = page.getByTestId('workspace-instance-bar');
    const menu = (await bar.locator('.folder-more').boundingBox())!;
    const track = bar.locator('.folder-tab-list'); const bounds = (await track.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(menu.x + menu.width);
    const first = (await track.locator('.folder-tab').first().boundingBox())!;
    expect(first.x - menu.x - menu.width).toBeLessThanOrEqual(8);
    const labels = await bar.locator('.folder-actions button:visible').evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')));
    if (area === 'code') expect(labels.slice(-2)).toEqual(['打开文件', '新建文件']);
    if (area === 'ai') expect(labels.slice(-2)).toEqual(['新对话', '连接服务器']);
    if (area === 'terminal') expect(labels.slice(-2)).toEqual(['新建终端', '新建终端选项']);
  }
  await page.setViewportSize({ width: 500, height: 800 });
  const search = page.getByTestId('global-search-trigger');
  await expect(page.locator('.workspace-titlebar')).toHaveAttribute('data-search-compact', 'true');
  await expect(search.locator('kbd')).toBeHidden();
  expect(await search.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await search.click(); await expect(page.getByRole('dialog', { name: '全局搜索', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.screenshot({ path: info.outputPath('compact-titlebar.png'), animations: 'disabled' });
});
