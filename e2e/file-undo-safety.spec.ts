import { expect, test } from '@playwright/test';
import { mkdtemp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clipboardFiles, setupTauriMock, waitForWorkbench } from './tauri-mock';

test('consecutive undo preserves a real colliding file on disk', async ({ page }, info) => {
  const root = (await mkdtemp(join(tmpdir(), 'file-undo-browser-'))).replace(/\\/g, '/');
  const directory = '/review-undo';
  try {
    await setupTauriMock(page, { launchDirectory: directory, terminalDirectories: true });
    await page.exposeFunction('fileSafetyOperation', async (command: string, args: Record<string, unknown>) => {
      const checked = (value: unknown) => {
        const path = String(value);
        if ((path !== directory && !path.startsWith(`${directory}/`)) || path.split('/').includes('..') || path.includes('\\')) throw new Error('Path outside fixture');
        return root + path.slice(directory.length);
      };
      if (command === 'fs_list') return (await readdir(checked(args.path), { withFileTypes: true })).map(entry => ({ name: entry.name, path: `${String(args.path)}/${entry.name}`, is_dir: entry.isDirectory() }));
      if (command === 'fs_create_file') {
        const path = checked(`${String(args.dir)}/${String(args.name)}`);
        await writeFile(path, 'owned', { flag: 'wx' }); return directory + path.slice(root.length);
      }
      if (command === 'fs_rename') {
        const from = checked(args.oldPath); const parent = from.slice(0, from.lastIndexOf('/'));
        let target = checked(directory + `${parent}/${String(args.newName)}`.slice(root.length));
        for (let index = 1; existsSync(target); index++) target = `${parent}/${String(args.newName)} (${index})`;
        await rename(from, target); return directory + target.slice(root.length);
      }
      if (command === 'fs_stage_delete') {
        await mkdir(`${root}/staging`, { recursive: true });
        const completed = [];
        for (const value of args.paths as string[]) {
          const from = checked(value); const to = `${root}/staging/${from.split('/').pop()}`;
          await rename(from, to); completed.push({ from: value, to: directory + to.slice(root.length) });
        }
        return { completed, errors: [] };
      }
      throw new Error(`Unexpected fixture operation: ${command}`);
    });
    await page.addInitScript(() => {
      const bridge = window as unknown as { fileSafetyOperation: (command: string, args: Record<string, unknown>) => Promise<unknown>; __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } };
      const original = bridge.__TAURI_INTERNALS__.invoke;
      bridge.__TAURI_INTERNALS__.invoke = (command, args) => ['fs_list', 'fs_create_file', 'fs_rename', 'fs_stage_delete'].includes(command)
        ? bridge.fileSafetyOperation(command, args ?? {}) : original(command, args);
    });
    await page.goto('/'); await waitForWorkbench(page);
    await page.locator('[data-dock-btn="files"]').click();
    const tree = page.getByTestId('local-file-tree');
    await expect(tree).toHaveAttribute('data-path', directory);
    await page.getByTestId('local-more-btn').click();
    await page.getByRole('button', { name: '新建文件', exact: true }).click();
    await page.getByTestId('rename-input').fill('renamed');
    await page.getByTestId('rename-input').press('Enter');
    await page.getByTestId('confirm-ok').click();
    await expect.poll(() => existsSync(`${root}/renamed`)).toBe(true);
    await writeFile(`${root}/Untitled`, 'unrelated');
    await page.getByTestId('local-more-btn').click();
    await page.getByRole('button', { name: /回退重命名/ }).click();
    await expect.poll(() => existsSync(`${root}/Untitled (1)`)).toBe(true);
    await page.setViewportSize({ width: 760, height: 800 });
    await page.getByTestId('local-more-btn').click();
    await page.getByRole('button', { name: /回退新建/ }).click();
    await expect.poll(() => existsSync(`${root}/Untitled (1)`)).toBe(false);
    expect(await readFile(`${root}/Untitled`, 'utf8')).toBe('unrelated');
    expect(await readFile(`${root}/staging/Untitled (1)`, 'utf8')).toBe('owned');
    await page.screenshot({ path: info.outputPath('safe-undo-narrow.png') });
  } finally {
    await page.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('remote copy and cut leave the local system clipboard unchanged', async ({ page }) => {
  await setupTauriMock(page, { sshHost: 'known' });
  await page.goto('/'); await waitForWorkbench(page);
  await page.locator('[data-dock-btn="ssh"]').click();
  await page.getByTestId('ssh-row-ssh-1').dblclick();
  await page.getByRole('button', { name: '断开连接', exact: true }).waitFor();
  await page.locator('[data-dock-btn="files"]').click();
  const before = await clipboardFiles(page);
  await page.getByTestId('remote-file-app.log').click();
  await page.keyboard.press('Control+c');
  await expect(page.getByText('已复制', { exact: true })).toBeVisible();
  expect(await clipboardFiles(page)).toEqual(before);
  await page.keyboard.press('Control+x');
  await expect(page.getByTestId('remote-file-app.log')).toHaveCSS('opacity', '0.55');
  expect(await clipboardFiles(page)).toEqual(before);
});
