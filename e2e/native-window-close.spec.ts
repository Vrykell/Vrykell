import { expect, test, type Page } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

async function nativeClose(page: Page) {
  await page.evaluate(() => (window as unknown as { __EMIT_EVENT__: (event: string, payload: unknown) => void }).__EMIT_EVENT__('tauri://close-requested', null));
}
async function destroys(page: Page) {
  return page.evaluate(() => (window as unknown as { __WINDOW_OPS__: { command: string }[] }).__WINDOW_OPS__.filter(item => item.command === 'plugin:window|destroy').length);
}
test.beforeEach(async ({ page }) => {
  await setupTauriMock(page, { schedulesSeed: [] }); await page.goto('/');
  await expect(page.locator('[data-terminal-input]')).toBeVisible();
});

for (const source of ['titlebar', 'system']) test(`a clean ${source} close completes through the configured native capability`, async ({ page }) => {
  if (source === 'titlebar') await page.getByTestId('window-close').click(); else await nativeClose(page);
  await expect.poll(() => destroys(page)).toBe(1);
});

for (const action of ['discard', 'save', 'failure']) test(`a native close preserves the unsaved-document ${action} flow`, async ({ page }) => {
  await page.evaluate(async () => {
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    useWorkspaceStore.getState().openEditorFile({ path: '/home/e2e/project/src/main.ts' });
  });
  const editor = page.getByTestId('file-editor');
  await expect(editor.locator('.monaco-editor')).toBeVisible();
  await editor.locator('textarea.inputarea').focus();
  await page.keyboard.press('Control+a'); await page.keyboard.insertText('unsaved native-close draft');
  await nativeClose(page);
  const dialog = page.getByRole('dialog', { name: '未保存的更改' });
  await expect(dialog).toBeVisible();
  expect(await destroys(page)).toBe(0);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(editor.locator('.view-lines')).toContainText('unsaved native-close draft');
  expect(await destroys(page)).toBe(0);
  await page.getByTestId('window-close').click();
  await expect(dialog).toBeVisible();
  if (action === 'failure') {
    await page.evaluate(() => {
      const bridge = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
      const invoke = bridge.invoke;
      bridge.invoke = (command, args) => command === 'editor_save_file' ? Promise.reject(new Error('Write failed')) : invoke(command, args);
    });
  }
  await dialog.getByRole('button', { name: action === 'discard' ? '放弃并关闭' : '保存并关闭', exact: true }).click();
  if (action === 'failure') {
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect(await destroys(page)).toBe(0);
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(editor.locator('.view-lines')).toContainText('unsaved native-close draft');
  } else {
    await expect.poll(() => destroys(page)).toBe(1);
    if (action === 'save') expect(await page.evaluate(() => localStorage.getItem('mock-editor-files'))).toContain('unsaved native-close draft');
  }
});
