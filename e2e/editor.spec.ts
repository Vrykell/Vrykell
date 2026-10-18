import { expect, test, type Page } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
test.setTimeout(60_000);
test.beforeEach(async ({ page }) => {
  await setupTauriMock(page.context(), { launchDirectory: '/home/e2e/project', terminalDirectories: true, schedulesSeed: [] });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '版本控制', exact: true }).click();
});
async function openWorking(page: Page, path = 'src/main.ts', scope = 'unstaged') {
  const row = page.getByTestId(`git-${scope}-${path}`); await row.hover(); await row.getByRole('button', { name: '打开工作文件' }).click();
  await expect(page.getByTestId('file-editor').locator('.monaco-editor')).toBeVisible({ timeout: 15_000 });
}
async function replaceText(page: Page, text: string) {
  const input = page.getByTestId('file-editor').locator('textarea.inputarea'); await input.focus(); await page.keyboard.press('Control+a'); await page.keyboard.insertText(text);
}

test('opens text in the built-in editor, saves it and guards unsaved closes', async ({ page }, info) => {
  await openWorking(page);
  const editor = page.getByTestId('file-editor'); await replaceText(page, 'export const value = "saved";');
  await expect(editor.getByRole('button', { name: '保存文件', exact: true })).toBeEnabled();
  await page.keyboard.press('Control+s');
  await expect(editor.getByRole('button', { name: '保存文件', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mock-editor-files')!)['["","/home/e2e/project/src/main.ts"]'])).toContain('saved');
  for (const width of [1240, 760]) { await page.setViewportSize({ width, height: 800 }); await page.screenshot({ path: info.outputPath(`editor-${width}.png`) }); }
  await replaceText(page, 'unsaved draft'); await page.keyboard.press('Control+w');
  let dialog = page.getByRole('dialog', { name: '未保存的更改' }); await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '取消', exact: true }).click(); await expect(editor).toBeVisible();
  await page.keyboard.press('Control+w'); dialog = page.getByRole('dialog', { name: '未保存的更改' });
  await dialog.getByRole('button', { name: '保存并关闭' }).click(); await expect(editor).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mock-editor-files')!)['["","/home/e2e/project/src/main.ts"]'])).toContain('unsaved draft');
});

test('retains drafts on disk conflicts and requires confirmation before reload', async ({ page }) => {
  await openWorking(page); const editor = page.getByTestId('file-editor'); await replaceText(page, 'local draft');
  await page.evaluate(() => localStorage.setItem('mock-editor-files', JSON.stringify({ '["","/home/e2e/project/src/main.ts"]': 'external text' })));
  await page.keyboard.press('Control+s'); await expect(editor.getByRole('alert')).toBeVisible();
  await expect(editor.locator('.view-lines')).toContainText('local draft');
  await editor.getByRole('button', { name: '重新加载文件' }).click(); await page.getByTestId('confirm-cancel').click();
  await expect(editor.locator('.view-lines')).toContainText('local draft');
  await editor.getByRole('button', { name: '重新加载文件' }).click(); await page.getByTestId('confirm-ok').click();
  await expect(editor.locator('.view-lines')).toContainText('external text');
});

test('switches editor page modes without losing open buffers and offers terminal preference', async ({ page }) => {
  await openWorking(page); await replaceText(page, 'keep this buffer');
  await openWorking(page, 'new file.ts', 'untracked');
  await expect(page.getByRole('tablist', { name: '已打开的文件' }).getByRole('tab')).toHaveCount(2);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '本地编辑器', exact: true }).click();
  await page.getByRole('combobox', { name: '编辑器页面' }).click(); await page.getByRole('option', { name: '多页，每个文件独立打开' }).click();
  await openWorking(page); await expect(page.getByRole('tablist', { name: '已打开的文件' })).toHaveCount(0);
  await expect(page.getByTestId('file-editor').locator('.view-lines')).toContainText('keep this buffer');
  await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('button', { name: '本地编辑器', exact: true }).click();
  await page.getByRole('combobox', { name: '编辑器页面' }).click(); await page.getByRole('option', { name: '单页，使用文件标签' }).click();
  await page.getByRole('combobox', { name: '首选文件编辑器' }).click(); await page.getByRole('option', { name: '终端编辑器', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('vrykell-editor-preferences')!).state.localOpenMode)).toBe('terminal');
});

test('returns from a comparison to its editor and explains binary files', async ({ page }) => {
  await openWorking(page);
  await page.getByTestId('git-unstaged-src/main.ts').click();
  await page.getByTestId('git-diff-review').getByRole('button', { name: '更多编辑器操作' }).click();
  await page.getByRole('button', { name: '返回编辑器', exact: true }).click();
  await expect(page.getByTestId('file-editor')).toBeVisible();
  const image = page.getByTestId('git-unstaged-image.png'); await image.hover(); await image.getByRole('button', { name: '打开工作文件' }).click();
  await expect(page.getByTestId('file-editor').getByText('此文件是二进制或非 UTF-8 文本，请使用其他编辑器打开。')).toBeVisible();
});

test('reorders connected file tabs and keeps compact actions above the text', async ({ page }, info) => {
  await openWorking(page); await openWorking(page, 'new file.ts', 'untracked');
  const strip = page.getByRole('tablist', { name: '已打开的文件' });
  const source = (await strip.getByRole('tab').nth(1).boundingBox())!; const target = (await strip.getByRole('tab').first().boundingBox())!;
  await page.mouse.move(source.x + 28, source.y + source.height / 2); await page.mouse.down();
  await page.mouse.move(target.x + 10, target.y + target.height / 2, { steps: 12 });
  const slot = page.locator('[data-reorder-placeholder]'); await expect(slot).toBeVisible();
  expect(await slot.evaluate(element => {
    const style = getComputedStyle(element);
    return [style.borderTopLeftRadius, style.borderBottomLeftRadius, style.borderBottomRightRadius].map(parseFloat).every(radius => radius > 0);
  })).toBe(true);
  await page.mouse.up();
  await expect(strip.getByRole('tab').first()).toContainText('new file.ts');
  await expect(strip.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
  const header = page.getByTestId('file-editor').locator('.folder-header');
  expect((await header.boundingBox())!.height).toBeLessThanOrEqual(34);
  expect((await strip.getByRole('tab').first().boundingBox())!.x - (await strip.boundingBox())!.x).toBeGreaterThanOrEqual(12);
  const inactive = strip.getByRole('tab').nth(1).locator('..'); await inactive.hover();
  expect(await inactive.evaluate(element => parseFloat(getComputedStyle(element).borderBottomLeftRadius))).toBeGreaterThan(0);
  expect(await inactive.evaluate(element => getComputedStyle(element, '::before').content)).toBe('none');
  const editor = page.getByTestId('file-editor');
  for (const width of [1240, 760]) {
    await page.setViewportSize({ width, height: 800 });
    const path = (await editor.locator('.folder-path').boundingBox())!; const body = (await editor.locator('.code-editor-frame').boundingBox())!;
    expect(path.height).toBeLessThanOrEqual(26); expect(path.y + path.height).toBeLessThanOrEqual(body.y + 1);
    expect(await strip.getByRole('tab').first().locator('..').evaluate(element => getComputedStyle(element).backgroundColor)).toBe(await editor.locator('.code-editor-frame').evaluate(element => getComputedStyle(element).backgroundColor));
    await page.screenshot({ path: info.outputPath(`folder-tabs-${width}.png`) });
  }
  await expect(editor.getByRole('button', { name: '在终端中打开', exact: true })).not.toBeVisible();
  await editor.getByRole('button', { name: '更多编辑器操作' }).click();
  await expect(page.getByRole('menu').getByRole('button', { name: '在终端中打开', exact: true })).toBeVisible();
});
