import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { setupTauriMock } from './tauri-mock';
import { openWorkspaceActions } from './workbench';

let server: ViteDevServer;

test.beforeAll(async () => {
  server = await createServer({
    cacheDir: 'node_modules/.vite-editor-hmr',
    server: { host: '127.0.0.1', port: 0, strictPort: true },
  });
  await server.listen();
});

test.afterAll(async () => { await server?.close(); });

test('localization hot updates retain editor registrations, buffers and modal bindings', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await setupTauriMock(page.context(), {});
  await page.goto(server.resolvedUrls!.local[0], { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-terminal-input]')).toBeVisible();
  await page.evaluate(async () => {
    const path = '/src/features/workspace/stores/navigation.ts';
    const { useWorkspaceNavigation } = await import(path) as typeof import('../src/features/workspace/stores/navigation');
    useWorkspaceNavigation.getState().selectArea('code');
  });
  await page.getByTestId('code-start-page-content').getByRole('button', { name: '新建文件', exact: true }).click();
  const editor = page.getByTestId('file-editor');
  await expect(editor.locator('.monaco-editor')).toBeVisible({ timeout: 30_000 });
  await editor.locator('textarea.inputarea').focus();
  await page.keyboard.insertText('Keep this unsaved note');
  await openWorkspaceActions(page);
  await page.getByRole('menu').locator('button').filter({ hasText: 'Vim 模式' }).click();
  await expect(editor.locator('.code-editor-vim-status')).toContainText('NORMAL');
  await page.evaluate(async () => {
    const path = '/@vite/client';
    const { createHotContext } = await import(path) as { createHotContext: (path: string) => { on: (event: string, callback: () => void) => void } };
    createHotContext('/editor-update-probe').on('vite:afterUpdate', () => {
      document.documentElement.dataset.editorHotUpdated = 'true';
    });
  });
  server.watcher.emit('change', resolve('src/ui/editor/code/localize.ts'));
  await expect(page.locator('html')).toHaveAttribute('data-editor-hot-updated', 'true', { timeout: 20_000 });
  await expect(editor.getByRole('alert')).toHaveCount(0);
  await expect(editor.locator('.view-lines')).toContainText('Keep this unsaved note');
  await expect(editor.locator('.code-editor-vim-status')).toContainText('NORMAL');
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: '新建文件', exact: true }).click();
  await expect(page.getByTestId('file-editor').locator('.monaco-editor')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('file-editor').getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
});
