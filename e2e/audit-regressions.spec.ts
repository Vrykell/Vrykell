import { expect, test } from '@playwright/test';
import { fsOps, ptyWrites, setupTauriMock } from './tauri-mock';

for (const [shell, directory, command] of [
  ['bash', "/tmp/it's $HOME", "cd -- '/tmp/it'\\''s $HOME'\r"],
  ['pwsh', "D:/it's $HOME", "Set-Location -LiteralPath 'D:/it''s $HOME'\r"],
  ['cmd', 'D:/my workspace', 'cd /d "D:/my workspace"\r'],
] as const) {
  test(`directory synchronization uses the focused ${shell} shell`, async ({ page }) => {
    await setupTauriMock(page, { schedulesSeed: [], shells: [{ id: shell, label: shell, default: true }] });
    await page.addInitScript(directory => {
      localStorage.setItem('vrykell-files-location', JSON.stringify({ state: { remembered: { path: directory } }, version: 0 }));
    }, directory);
    await page.goto('/');
    await page.locator('[data-dock-btn="files"]').click();
    await expect(page.getByTestId('local-file-tree')).toHaveAttribute('data-path', directory);
    await page.getByTestId('local-more-btn').click();
    await page.getByRole('button', { name: /终端切换到当前目录/ }).click();
    await expect.poll(() => ptyWrites(page)).toContain(command);
  });
}

test('a partial deletion keeps an undo action for the completed item', async ({ page }) => {
  await setupTauriMock(page, { schedulesSeed: [] });
  await page.addInitScript(() => {
    const host = window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } };
    const original = host.__TAURI_INTERNALS__.invoke;
    host.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command !== 'fs_stage_delete') return original(command, args);
      const paths = args?.paths as string[];
      const result = await original(command, { ...args, paths: [paths[0]] }) as { completed: unknown[]; errors: string[] };
      return { ...result, errors: ['Access denied for the remaining item'] };
    };
  });
  await page.goto('/');
  await page.locator('[data-dock-btn="files"]').click();
  const tree = page.getByTestId('local-file-tree');
  const notes = tree.locator('[data-testid="file-row"][data-path="/home/e2e/notes.txt"]');
  const documents = tree.locator('[data-testid="file-row"][data-path="/home/e2e/Documents"]');
  await notes.click();
  await documents.click({ modifiers: ['Control'] });
  await notes.click({ button: 'right' });
  await page.getByRole('button', { name: '删除 2 项', exact: true }).click();
  await page.getByTestId('confirm-ok').click();
  await expect.poll(async () => (await fsOps(page)).filter(operation => operation.op === 'delete')).toHaveLength(1);
  await page.getByTestId('local-more-btn').click();
  await page.getByRole('button', { name: /^回退删除/ }).click();
  await expect.poll(async () => (await fsOps(page)).filter(operation => operation.op === 'restore')).toHaveLength(1);
});
