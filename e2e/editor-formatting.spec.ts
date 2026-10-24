import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test('previews markdown without execution actions and switches real encoding requests', async ({ page }, info) => {
  await setupTauriMock(page, { schedulesSeed: [] });
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await page.evaluate(async () => {
    document.documentElement.dataset.nativeMaterial = 'fallback';
    localStorage.setItem('mock-editor-files', JSON.stringify({ '["","/notes/readme.md"]': '# A note\n\n```sh\necho harmless\n```\n\n**Preview text**' }));
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    useWorkspaceStore.getState().openEditorFile({ path: '/notes/readme.md' });
  });
  const editor = page.getByTestId('file-editor');
  await expect(editor.locator('.monaco-editor')).toBeVisible();
  const before = (await editor.locator('.code-editor-frame').boundingBox())!;
  await page.keyboard.press('Control+f');
  await expect(editor.locator('.find-widget')).toBeVisible();
  expect((await editor.locator('.code-editor-frame').boundingBox())!.y).toBe(before.y);
  await page.keyboard.press('Escape');
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: 'Markdown 预览' }).click();
  await expect(editor.getByTestId('markdown-preview').getByRole('heading', { name: 'A note' })).toBeVisible();
  await expect(editor.getByTestId('markdown-preview').getByRole('button', { name: /运行/ })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('markdown-preview.png') });
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: 'Markdown 预览' }).click();
  await editor.getByRole('button', { name: '字符集', exact: true }).click();
  await page.getByRole('menuitem', { name: '使用字符集保存', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'UTF-16 LE', exact: true }).click();
  await expect(editor.getByRole('button', { name: '字符集', exact: true })).toHaveText('UTF-16 LE');
  const status = (await editor.locator('.code-editor-status').boundingBox())!;
  const path = (await editor.getByTestId('editor-file-path').boundingBox())!;
  expect(Math.abs(status.y - path.y)).toBeLessThan(10);
  await page.screenshot({ path: info.outputPath('editor-status-encoding.png') });
});
