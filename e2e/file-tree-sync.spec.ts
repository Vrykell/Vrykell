import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

interface SyncFixture {
  files: string[];
  hold: boolean;
  pending: boolean;
  release?: () => void;
  gaps: number;
  failure: boolean;
  requests: number;
  holdPath?: string;
}

for (const mode of ['local', 'ssh'] as const) {
  test(`${mode} file tree syncs external changes and retains rows during slow refreshes and mutations`, async ({ page }, info) => {
    await setupTauriMock(page, { integration: mode === 'local' });
    await page.addInitScript(mode => {
      const host = window as unknown as {
        __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
        __FILE_SYNC__: SyncFixture;
      };
      const state = host.__FILE_SYNC__ = { files: ['old.txt'], hold: false, pending: false, gaps: 0, failure: false, requests: 0 } as SyncFixture;
      const root = mode === 'local' ? '/home/e2e/project' : '/home/root';
      const original = host.__TAURI_INTERNALS__.invoke;
      host.__TAURI_INTERNALS__.invoke = async (command, args) => {
        if (command === (mode === 'local' ? 'fs_rename' : 'ssh_rename')) {
          const path = String(args?.path ?? args?.oldPath);
          const name = String(args?.newName);
          state.files = state.files.map(value => value === path.split('/').pop() ? name : value);
          return `${root}/src/${name}`;
        }
        if (command !== (mode === 'local' ? 'fs_list' : 'ssh_list')) return original(command, args);
        state.requests += 1;
        if (state.failure) throw new Error('Read unavailable');
        const path = args?.path ?? root;
        if (path === (state.holdPath ?? root) && state.hold) {
          state.pending = true;
          await new Promise<void>(resolve => { state.release = () => { state.pending = false; state.hold = false; resolve(); }; });
        }
        const entries = path === root
          ? [{ name: 'src', path: `${root}/src`, is_dir: true }, ...Array.from({ length: 40 }, (_, index) => ({
            name: `stable-${index}.txt`, path: `${root}/stable-${index}.txt`, is_dir: false,
          }))]
          : state.files.map(name => ({ name, path: `${root}/src/${name}`, is_dir: false }));
        return mode === 'local' ? entries : { base: path, entries };
      };
    }, mode);
    await page.goto('/');
    if (mode === 'ssh') {
      await page.locator('[data-dock-btn="ssh"]').click();
      await page.getByTestId('ssh-row-ssh-1').dblclick();
    }
    await page.locator('[data-dock-btn="files"]').click();
    const tree = page.getByTestId(mode === 'local' ? 'local-file-tree' : 'remote-file-tree');
    const root = mode === 'local' ? '/home/e2e/project' : '/home/root';
    const src = tree.locator(`[data-file-row][data-path="${root}/src"]`);
    await src.locator('[data-row-expander]').click();
    await expect(tree.getByText('old.txt', { exact: true })).toBeVisible();

    await page.evaluate(() => { (window as unknown as { __FILE_SYNC__: SyncFixture }).__FILE_SYNC__.files = ['new.txt']; });
    await expect(tree.getByText('new.txt', { exact: true })).toBeVisible({ timeout: 12000 });
    await expect(tree.getByText('old.txt', { exact: true })).toHaveCount(0);
    await src.click();
    await tree.evaluate(element => {
      const state = (window as unknown as { __FILE_SYNC__: SyncFixture }).__FILE_SYNC__;
      new MutationObserver(() => { if (!element.querySelector('[data-file-row]')) state.gaps += 1; })
        .observe(element, { childList: true, subtree: true });
      state.hold = true;
      element.scrollTop = 50;
    });
    await page.getByTestId(mode === 'local' ? 'local-more-btn' : 'remote-more-btn').click();
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __FILE_SYNC__: SyncFixture }).__FILE_SYNC__.pending)).toBe(true);
    for (const width of [1240, 760]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(tree.locator('[data-file-row]')).toHaveCount(42);
      await expect(src).toHaveAttribute('data-selected', 'true');
      await expect(tree.getByText('正在连接文件服务…', { exact: true })).toHaveCount(0);
      await expect(tree.getByText('正在读取目录…', { exact: true })).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`${mode}-refresh-${width}.png`) });
    }
    expect(await tree.evaluate(element => element.scrollTop)).toBe(50);
    await page.evaluate(() => { (window as unknown as { __FILE_SYNC__: SyncFixture }).__FILE_SYNC__.release?.(); });
    await tree.evaluate(element => { element.scrollTop = 0; });

    await tree.getByText('new.txt', { exact: true }).click({ button: 'right' });
    await page.getByRole('button', { name: '重命名', exact: true }).click();
    await page.getByTestId('rename-input').fill('renamed.txt');
    await page.getByTestId('rename-input').press('Enter');
    await page.evaluate(root => {
      const state = (window as unknown as { __FILE_SYNC__: SyncFixture }).__FILE_SYNC__;
      state.hold = true; state.holdPath = `${root}/src`;
    }, root);
    await page.getByRole('dialog').getByRole('button', { name: '重命名', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __FILE_SYNC__: SyncFixture }).__FILE_SYNC__.pending)).toBe(true);
    await expect(src).toBeVisible();
    await expect(tree.getByText('正在连接文件服务…', { exact: true })).toHaveCount(0);
    await page.evaluate(() => { (window as unknown as { __FILE_SYNC__: SyncFixture }).__FILE_SYNC__.release?.(); });
    await expect(tree.getByText('renamed.txt', { exact: true })).toBeVisible();
    await expect(tree.getByText('new.txt', { exact: true })).toHaveCount(0);
    await page.evaluate(() => {
      (window as unknown as { __FILE_SYNC__: SyncFixture }).__FILE_SYNC__.failure = true;
      window.dispatchEvent(new Event('focus'));
    });
    const retry = page.getByRole('button', { name: mode === 'local' ? '重试' : '重试文件服务', exact: true });
    await expect(retry).toBeVisible();
    await expect(tree.getByText('renamed.txt', { exact: true })).toBeVisible();
    await page.evaluate(() => { (window as unknown as { __FILE_SYNC__: SyncFixture }).__FILE_SYNC__.failure = false; });
    await retry.click();
    await expect(retry).toHaveCount(0);
    await expect(tree.getByText('renamed.txt', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __FILE_SYNC__: SyncFixture }).__FILE_SYNC__.gaps)).toBe(0);

    const reads = await page.evaluate(() => (window as unknown as { __FILE_SYNC__: SyncFixture }).__FILE_SYNC__.requests);
    await src.dblclick();
    await expect(tree).toHaveAttribute('data-path', `${root}/src`);
    await page.evaluate(root => {
      const state = (window as unknown as { __FILE_SYNC__: SyncFixture }).__FILE_SYNC__;
      state.hold = true; state.holdPath = root;
    }, root);
    await page.getByTestId(mode === 'local' ? 'local-back-btn' : 'remote-back-btn').click();
    await expect(src).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __FILE_SYNC__: SyncFixture }).__FILE_SYNC__.requests)).toBe(reads);
    await expect(tree.getByText('正在连接文件服务…', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`${mode}-history-back.png`) });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => page.evaluate(() => (window as unknown as { __FILE_SYNC__: SyncFixture }).__FILE_SYNC__.pending)).toBe(true);
    await page.getByTestId(mode === 'local' ? 'local-forward-btn' : 'remote-forward-btn').click();
    await expect(tree).toHaveAttribute('data-path', `${root}/src`);
    await expect(tree.getByText('renamed.txt', { exact: true })).toBeVisible();
    await page.evaluate(() => { (window as unknown as { __FILE_SYNC__: SyncFixture }).__FILE_SYNC__.release?.(); });
    await expect(tree).toHaveAttribute('data-path', `${root}/src`);
    await expect(tree.getByText('stable-0.txt', { exact: true })).toHaveCount(0);
  });
}
