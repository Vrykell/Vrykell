import { expect, test } from '@playwright/test';
import { ptyWrites, setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page, { launchDirectory: '/home/e2e/project', terminalDirectories: true, schedulesSeed: [], sshHost: 'known' });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
});

test('restores the last directory on launch without restoring the navigation trail', async ({ page }, info) => {
  await page.locator('[data-dock-btn="files"]').click();
  const tree = page.getByTestId('local-file-tree');
  await tree.locator('[data-path="/home/e2e/Documents"]').dblclick();
  await expect(tree).toHaveAttribute('data-path', '/home/e2e/Documents');
  await expect(page.getByTestId('local-back-btn')).toBeEnabled();
  await page.reload({ waitUntil: 'domcontentloaded' });
  if (!await tree.isVisible()) await page.locator('[data-dock-btn="files"]').click();
  await expect(tree).toHaveAttribute('data-path', '/home/e2e/Documents');
  await expect(page.getByTestId('local-back-btn')).toBeDisabled();
  await expect(page.getByTestId('local-forward-btn')).toBeDisabled();
  await page.getByTestId('local-more-btn').click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('img', { name: 'Control+Alt+L', exact: true })).toBeVisible();
  await expect(menu.getByRole('img', { name: 'Control+Alt+Shift+L', exact: true })).toBeVisible();
  for (const width of [1240, 760]) {
    await page.setViewportSize({ width, height: 800 });
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`file-shortcuts-${width}.png`) });
  }
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Alt+l');
  await expect.poll(() => ptyWrites(page)).toContain("cd '/home/e2e/Documents'\r");
  await page.keyboard.press('Control+Alt+Shift+l');
  await expect(tree).toHaveAttribute('data-path', '/home/e2e/project');
});

test('completes real local paths with Tab even with predictive suggestions disabled', async ({ page }) => {
  await page.evaluate(async () => {
    const path = '/src/features/agent/stores/agentSettings.ts';
    const { useAgentSettings } = await import(path) as typeof import('../src/features/agent/stores/agentSettings');
    useAgentSettings.setState(state => ({ global: { ...state.global, completeEnabled: false } }));
    (window as unknown as { __FS_EXTRA_ENTRIES__: unknown[] }).__FS_EXTRA_ENTRIES__ = [
      { name: 'notes-two.txt', path: '/home/e2e/notes-two.txt', is_dir: false },
      { name: 'my file.txt', path: '/home/e2e/my file.txt', is_dir: false },
    ];
  });
  const input = page.getByPlaceholder(/输入命令/);
  await input.fill('cat not'); await input.press('Tab');
  await expect(input).toHaveValue('cat notes-two.txt');
  await input.press('Tab'); await expect(input).toHaveValue('cat notes.txt');
  await input.press('Shift+Tab'); await expect(input).toHaveValue('cat notes-two.txt');
  await input.press('Escape'); await expect(input).toHaveValue('cat not');
  await input.fill('cd Doc'); await input.press('Tab'); await expect(input).toHaveValue('cd Documents/');
  await input.fill('cat my'); await input.press('Tab'); await expect(input).toHaveValue('cat my\\ file.txt');
  await expect(input).toBeFocused();
  expect((await ptyWrites(page)).some(write => write.includes('cat notes'))).toBe(false);
});

test('keeps late completion responses out of an edited draft', async ({ page }) => {
  await page.evaluate(() => {
    const host = window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> }; __COMPLETE_PENDING__?: boolean; __FINISH_COMPLETE__?: () => void };
    const original = host.__TAURI_INTERNALS__.invoke;
    host.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command === 'fs_list' && args?.path === '/home/e2e/project') {
        host.__COMPLETE_PENDING__ = true;
        await new Promise<void>(resolve => { host.__FINISH_COMPLETE__ = resolve; });
      }
      return original(command, args);
    };
  });
  const input = page.getByPlaceholder(/输入命令/);
  await input.fill('cat not'); await input.press('Tab');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __COMPLETE_PENDING__?: boolean }).__COMPLETE_PENDING__)).toBe(true);
  await input.fill('cat other');
  await page.evaluate(() => (window as unknown as { __FINISH_COMPLETE__?: () => void }).__FINISH_COMPLETE__?.());
  await expect(input).toHaveValue('cat other');
});

test('restores remote locations separately and completes paths through the remote channel', async ({ page }) => {
  const openRemote = async () => {
    await page.evaluate(async () => {
      const settingsPath = '/src/features/agent/stores/agentSettings.ts';
      const { useAgentSettings } = await import(settingsPath) as typeof import('../src/features/agent/stores/agentSettings');
      useAgentSettings.setState(state => ({ global: { ...state.global, sshOpenMode: 'block', completeEnabled: false } }));
      const workspacePath = '/src/features/workspace/stores/workspace.ts';
      const { useWorkspaceStore } = await import(workspacePath) as typeof import('../src/features/workspace/stores/workspace');
      useWorkspaceStore.getState().addTab({ kind: 'ssh', ssh: { connectionId: 'ssh-1', host: 'prod.example.com', user: 'root', name: 'Remote' } });
    });
    if (!await page.getByTestId('remote-file-tree').isVisible()) await page.locator('[data-dock-btn="files"]').click();
    await expect(page.getByTestId('remote-file-tree')).toBeVisible();
  };
  await openRemote();
  const tree = page.getByTestId('remote-file-tree');
  await expect(tree).toHaveAttribute('data-path', '/home/root');
  await tree.locator('[data-path="/home/root/Documents"]').dblclick();
  await expect(tree).toHaveAttribute('data-path', '/home/root/Documents');
  await page.evaluate(() => {
    const host = window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> }; __PATH_CHANNELS__: string[] };
    const original = host.__TAURI_INTERNALS__.invoke;
    host.__PATH_CHANNELS__ = [];
    host.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command === 'fs_list' || command === 'ssh_list') host.__PATH_CHANNELS__.push(command);
      return original(command, args);
    };
  });
  const input = page.locator('textarea[data-terminal-input="true"]:visible');
  await input.fill('cat app'); await input.press('Tab'); await expect(input).toHaveValue('cat app.log');
  expect(await page.evaluate(() => (window as unknown as { __PATH_CHANNELS__: string[] }).__PATH_CHANNELS__)).toEqual(['ssh_list']);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openRemote();
  await expect(tree).toHaveAttribute('data-path', '/home/root/Documents');
  await expect(page.getByTestId('remote-back-btn')).toBeDisabled();
});

test('extracts shared editor settings and keeps modal editing across launches', async ({ page }, info) => {
  await gotoSetting(page, '编辑器设置');
  await page.getByRole('switch', { name: 'Vim 模式' }).click();
  await gotoSetting(page, '远程文件打开方式');
  await expect(page.getByRole('switch', { name: 'Vim 模式' })).toHaveCount(0);
  await gotoSetting(page, '编辑器设置');
  await expect(page.getByRole('switch', { name: 'Vim 模式' })).toHaveAttribute('aria-checked', 'true');
  await page.setViewportSize({ width: 760, height: 800 });
  await page.screenshot({ path: info.outputPath('vim-setting-narrow.png') });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await gotoSetting(page, '编辑器设置');
  await expect(page.getByRole('switch', { name: 'Vim 模式' })).toHaveAttribute('aria-checked', 'true');
});
