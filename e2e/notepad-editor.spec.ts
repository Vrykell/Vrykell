import { expect, test, type Page } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test.setTimeout(60_000);
test.beforeEach(async ({ page }) => {
  await setupTauriMock(page.context(), { schedulesSeed: [] });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const path = '/src/features/workspace/stores/navigation.ts';
    const { useWorkspaceNavigation } = await import(path) as typeof import('../src/features/workspace/stores/navigation');
    useWorkspaceNavigation.getState().selectArea('code');
    document.documentElement.dataset.nativeMaterial = 'fallback';
  });
  await expect(page.getByTestId('code-start-page')).toBeVisible();
  await page.getByTestId('code-start-page-content').getByRole('button', { name: '新建文件', exact: true }).click();
  await expect(page.getByTestId('file-editor').locator('.monaco-editor')).toBeVisible({ timeout: 20_000 });
});

async function typeNote(page: Page, text: string) {
  await page.getByTestId('file-editor').locator('textarea.inputarea').focus();
  await page.keyboard.press('Control+a'); await page.keyboard.insertText(text);
}
async function editorMenu(page: Page, label: string) {
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: '更多编辑器操作' }).click();
  await page.getByRole('menu').locator('button').filter({ hasText: label }).click();
}
async function destination(page: Page, path: string | null) {
  await page.evaluate(path => {
    (window as unknown as { __PICK_PATHS__: string[] }).__PICK_PATHS__ = path ? [path] : [];
    localStorage.setItem('mock-editor-missing', JSON.stringify(path ? [path] : []));
  }, path);
}

test('creates notes directly, cancels save safely, saves as and keeps using the chosen path', async ({ page }, info) => {
  await expect(page.getByTestId('file-editor').locator('.code-editor-status')).toContainText('尚未保存');
  await typeNote(page, 'A short note\nsecond line'); await destination(page, null); await page.keyboard.press('Control+s');
  await expect(page.getByTestId('file-editor').locator('.view-lines')).toContainText('A short note');
  await expect(page.getByTestId('file-editor').locator('.code-editor-status')).toContainText('尚未保存');
  await destination(page, '/home/e2e/notes/first.txt'); await page.keyboard.press('Control+s');
  await expect(page.getByTestId('file-editor').locator('.folder-path')).toContainText('/home/e2e/notes/first.txt');
  await expect(page.getByTestId('file-editor').locator('.code-editor-status')).not.toContainText('尚未保存');
  await typeNote(page, 'Updated note'); await page.keyboard.press('Control+s');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mock-editor-files') || '{}')['["","/home/e2e/notes/first.txt"]'])).toBe('Updated note');
  await destination(page, '/home/e2e/notes/copy.txt'); await editorMenu(page, '另存为…');
  await expect(page.getByTestId('file-editor').locator('.folder-path')).toContainText('/home/e2e/notes/copy.txt');
  await expect(page.getByRole('tablist', { name: '已打开的文件与比较' }).getByRole('tab')).toHaveCount(1);
  for (const width of [1240, 760]) {
    await page.setViewportSize({ width, height: 800 });
    const status = page.getByTestId('file-editor').locator('.code-editor-status'); await expect(status).toContainText('UTF-8');
    expect((await status.boundingBox())!.height).toBe(32);
    await page.screenshot({ path: info.outputPath(`text-editor-${width}.png`) });
  }
});

test('offers discard, undo, redo, find, replace, wrap and unsaved close recovery', async ({ page }) => {
  await typeNote(page, 'draft content');
  await editorMenu(page, '放弃更改'); await page.getByTestId('confirm-cancel').click();
  await expect(page.getByTestId('file-editor').locator('.view-lines')).toContainText('draft content');
  await editorMenu(page, '放弃更改'); await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('file-editor').locator('.view-lines')).not.toContainText('draft content');
  await typeNote(page, 'a new note');
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByTestId('file-editor').locator('.view-lines')).not.toContainText('a new note');
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: '重做', exact: true }).click();
  await expect(page.getByTestId('file-editor').locator('.view-lines')).toContainText('a new note');
  await editorMenu(page, '自动换行');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('vrykell-editor-preferences') || '{}').state.wordWrap)).toBe(true);
  await editorMenu(page, '查找'); await expect(page.getByTestId('file-editor').locator('.find-widget')).toBeVisible(); await page.keyboard.press('Escape');
  await editorMenu(page, '替换'); await expect(page.getByTestId('file-editor').locator('.replace-part :is(input, textarea)')).toBeVisible(); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '关闭文件 未命名 1.txt', exact: true }).click();
  const prompt = page.getByRole('dialog', { name: '未保存的更改' }); await expect(prompt).toBeVisible();
  await prompt.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByTestId('file-editor').locator('.view-lines')).toContainText('a new note');
  await page.getByRole('button', { name: '关闭文件 未命名 1.txt', exact: true }).click();
  await prompt.getByRole('button', { name: '放弃并关闭', exact: true }).click();
  await expect(page.getByTestId('code-start-page')).toBeVisible();
});

test('supports modal editing and writes through the same save path in Vim mode', async ({ page }) => {
  await editorMenu(page, 'Vim 模式');
  const status = page.getByTestId('file-editor').locator('.code-editor-vim-status');
  await expect(status).toContainText('NORMAL', { timeout: 15_000 });
  await page.getByTestId('file-editor').locator('textarea.inputarea').focus();
  await page.keyboard.press('i'); await page.keyboard.insertText('modal note'); await page.keyboard.press('Escape');
  await expect(page.getByTestId('file-editor').locator('.view-lines')).toContainText('modal note');
  await expect(status).toContainText('NORMAL');
  await destination(page, '/home/e2e/modal.txt');
  await page.keyboard.type(':w'); await page.keyboard.press('Enter');
  await expect(page.getByTestId('file-editor').locator('.folder-path')).toContainText('/home/e2e/modal.txt');
  await expect(page.getByTestId('file-editor').locator('.view-lines')).toContainText('modal note');
  await expect(status).toContainText('NORMAL');
  await page.getByTestId('file-editor').locator('textarea.inputarea').focus();
  await page.keyboard.type('/note');
  await expect(page.getByTestId('file-editor').getByRole('textbox', { name: 'Vim 命令' })).toHaveValue('note');
  await page.keyboard.press('Enter');
  await page.keyboard.type(':%s/modal/updated/g'); await page.keyboard.press('Enter');
  await expect(page.getByTestId('file-editor').locator('.view-lines')).toContainText('updated note');
  await page.keyboard.type(':wq'); await page.keyboard.press('Enter');
  await expect(page.getByTestId('code-start-page')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mock-editor-files') || '{}')['["","/home/e2e/modal.txt"]'])).toContain('updated note');
});

test('keeps native composition out of normal mode and does not replay a blocked preedit', async ({ page }) => {
  await editorMenu(page, 'Vim 模式');
  const status = page.getByTestId('file-editor').locator('.code-editor-vim-status');
  await expect(status).toContainText('NORMAL', { timeout: 15_000 });
  const editor = page.getByTestId('file-editor');
  const textarea = editor.locator('textarea.inputarea');
  await textarea.focus();
  const cdp = await page.context().newCDPSession(page);
  const compose = async (committed: string) => {
    await cdp.send('Input.imeSetComposition', { text: 'nihao', selectionStart: 5, selectionEnd: 5 });
    await cdp.send('Input.insertText', { text: committed });
  };
  await compose('你好');
  await expect(editor.locator('.view-lines')).not.toContainText('你好');
  await page.keyboard.press('i');
  await expect(status).toContainText('INSERT');
  await page.keyboard.insertText('a');
  // The blocked preedit must not be replayed when the editor starts accepting text.
  await expect(editor.locator('.view-lines')).toHaveText('a');
  await compose('你好');
  await expect(editor.locator('.view-lines')).toHaveText('a你好');
  await expect(status).toContainText('INSERT');
  await cdp.detach();
});
