import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test('manages uploads across panel navigation and reload in narrow and wide layouts', async ({ page }) => {
  await setupTauriMock(page);
  await page.addInitScript(() => {
    const api = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const original = api.invoke;
    const initial = { id: 'up1', direction: 'upload', name: 'large-backup.bin', remotePath: '/srv/backups/large-backup.bin', localPath: '/local/large-backup.bin', connectionId: 's1', connectionName: 'Server', isDir: false, status: 'running', bytes: 5242880, total: 10485760, speed: 1048576, error: '', createdAt: 1 };
    api.invoke = async (command, args) => {
      const job = JSON.parse(localStorage.getItem('test-transfer') ?? JSON.stringify(initial)) as typeof initial;
      if (command === 'transfers_list') return [job];
      if (command === 'transfers_control') {
        job.status = args?.action === 'pause' ? 'paused' : args?.action === 'cancel' ? 'cancelled' : 'running';
        localStorage.setItem('test-transfer', JSON.stringify(job));
        return;
      }
      return original(command, args);
    };
  });
  await page.goto('/');
  await page.locator('[data-dock-btn="files"]').click();
  const openUploads = async () => {
    await page.getByTestId('local-more-btn').click();
    await page.getByRole('button', { name: '上传管理', exact: true }).click();
    await expect(page.getByText('large-backup.bin', { exact: true })).toBeVisible();
    await expect(page.getByRole('combobox')).toHaveCount(0);
    await expect(page.getByText('上传管理', { exact: true })).toBeVisible();
  };
  await openUploads();
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect(page.getByRole('button', { name: '继续传输' })).toBeVisible();
  const handle = await page.getByTestId('resize-handle-files').boundingBox();
  if (!handle) throw new Error('File panel resize handle is unavailable');
  const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x - 220, y, { steps: 8 }); await page.mouse.up();
  await page.screenshot({ path: test.info().outputPath('transfers-wide.png') });
  const resized = await page.getByTestId('resize-handle-files').boundingBox();
  if (!resized) throw new Error('File panel resize handle is unavailable');
  await page.mouse.move(resized.x + resized.width / 2, y); await page.mouse.down();
  await page.mouse.move(x, y, { steps: 8 }); await page.mouse.up();
  await page.getByTestId('downloads-back').click();
  await openUploads();
  await expect(page.getByRole('button', { name: '继续传输' })).toBeVisible();
  await page.reload();
  if (!await page.getByTestId('local-more-btn').isVisible()) await page.locator('[data-dock-btn="files"]').click();
  await openUploads();
  await page.setViewportSize({ width: 680, height: 640 });
  await page.screenshot({ path: test.info().outputPath('transfers-narrow.png') });
  await page.getByRole('button', { name: '继续传输' }).click();
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '取消传输' }).click();
  await expect(page.getByText(/已取消/)).toBeVisible();
});

test('deletes a paused record so its incomplete data does not outlive it', async ({ page }) => {
  await setupTauriMock(page);
  await page.addInitScript(() => {
    const api = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const original = api.invoke;
    const job = { id: 'up2', direction: 'upload', name: 'paused.iso', remotePath: '/srv/paused.iso', localPath: '/local/paused.iso', connectionId: 's1', connectionName: 'Server', isDir: false, status: 'paused', bytes: 4096, total: 8192, speed: 0, error: '', createdAt: 1 };
    let jobs = [job];
    api.invoke = async (command, args) => {
      if (command === 'transfers_list') return jobs;
      if (command === 'transfers_delete') {
        (window as unknown as { __deletedTransfer__?: string }).__deletedTransfer__ = String(args?.id);
        jobs = [];
        return undefined;
      }
      return original(command, args);
    };
  });
  await page.goto('/');
  await page.locator('[data-dock-btn="files"]').click();
  await page.getByTestId('local-more-btn').click();
  await page.getByRole('button', { name: '上传管理', exact: true }).click();
  await expect(page.getByRole('button', { name: '继续传输' })).toBeVisible();
  await page.getByTestId('transfer-up2').hover();
  await page.getByTestId('transfer-delete-up2').click();
  await expect(page.getByText('暂无传输记录')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __deletedTransfer__?: string }).__deletedTransfer__)).toBe('up2');
});

test('persists undo opt-outs and confirms deletion without claiming it can be undone', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await page.locator('[data-dock-btn="settings"]').click();
  await page.getByRole('button', { name: '文件操作', exact: true }).click();
  await page.getByRole('switch', { name: '本地文件撤销' }).click();
  await page.getByRole('switch', { name: '远程文件撤销' }).click();
  await page.screenshot({ path: test.info().outputPath('undo-settings-wide.png') });
  await page.setViewportSize({ width: 680, height: 640 });
  await page.screenshot({ path: test.info().outputPath('undo-settings-narrow.png') });
  await page.reload();
  await page.setViewportSize({ width: 1240, height: 800 });
  await page.locator('[data-dock-btn="settings"]').click();
  await page.getByRole('button', { name: '文件操作', exact: true }).click();
  await expect(page.getByRole('switch', { name: '本地文件撤销' })).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('switch', { name: '远程文件撤销' })).toHaveAttribute('aria-checked', 'false');
  await page.locator('[data-dock-btn="settings"]').click();
  await page.locator('[data-dock-btn="files"]').click();
  const row = page.getByTestId('local-file-tree').locator('[data-path="/home/e2e/notes.txt"]');
  await row.click({ button: 'right' });
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('应用撤销已关闭');
});

for (const theme of ['dark', 'light'] as const) {
  for (const direction of ['upload', 'download'] as const) {
    test(`${direction} cards show complete task context without clipping in ${theme} narrow and wide panels`, async ({ page }, info) => {
      await setupTauriMock(page);
      await page.addInitScript(value => {
        const api = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
        const original = api.invoke;
        const base = { direction: value, connectionId: 's1', connectionName: 'Production backup server', isDir: false, error: '', createdAt: 3,
          localPath: '/local/project/backups/release/production-backup.tar.gz', remotePath: '/srv/project/backups/release/production-backup.tar.gz', bytes: 5242880, total: 10485760, speed: 1048576 };
        let jobs = [
          { ...base, id: 'active', name: 'production-backup-with-a-long-file-name.tar.gz', status: 'running' },
          { ...base, id: 'failed', name: 'protected-folder', isDir: true, status: 'failed', speed: 0, error: 'Permission denied: destination is read-only', createdAt: 2 },
          { ...base, id: 'complete', name: 'release.zip', status: 'completed', bytes: 10485760, speed: 0, localPath: '/local/release.zip', remotePath: '/srv/release.zip', createdAt: 1 },
        ];
        let history = value === 'download' ? [
          { id: 7, name: 'release.zip', localPath: '/local/release.zip', remotePath: '/srv/release.zip', connectionName: base.connectionName, isDir: false, size: 10485760, downloadedAt: 1 },
          { id: 8, name: 'archive.zip', localPath: '/local/archive.zip', remotePath: '/srv/archive.zip', connectionName: base.connectionName, isDir: false, size: 4096, downloadedAt: 1 },
        ] : [];
        api.invoke = async (command, args) => {
          if (command === 'transfers_list') return jobs;
          if (command === 'downloads_list') return history;
          if (command === 'transfers_control') {
            const job = jobs.find(item => item.id === args?.id);
            if (job) { job.status = args?.action === 'pause' ? 'paused' : args?.action === 'cancel' ? 'cancelled' : 'running'; }
            return;
          }
          if (command === 'transfers_clear') {
            jobs = jobs.filter(job => job.status !== 'completed');
            history = [];
            return;
          }
          return original(command, args);
        };
      }, direction);
      await page.goto('/');
      await page.locator('[data-dock-btn="settings"]').click();
      await page.locator('aside').getByRole('button', { name: '主题', exact: true }).click();
      await page.getByRole('radio', { name: theme === 'light' ? '浅色' : '深色', exact: true }).click();
      await page.locator('[data-dock-btn="settings"]').click();
      await page.locator('[data-dock-btn="files"]').click();
      await page.getByTestId('local-more-btn').click();
      await page.getByRole('button', { name: direction === 'upload' ? '上传管理' : '下载管理', exact: true }).click();
      const manager = page.getByTestId(`${direction}-manager`);
      await expect(manager.getByRole('region', { name: '进行中', exact: true })).toBeVisible();
      await expect(manager.getByRole('region', { name: '已停止', exact: true })).toBeVisible();
      await expect(manager.getByRole('region', { name: '已完成', exact: true })).toBeVisible();
      await expect(manager.getByText('release.zip', { exact: true })).toHaveCount(1);
      const active = manager.getByTestId('transfer-active');
      await expect(active.getByRole('definition').nth(0)).toHaveText(direction === 'upload' ? '/local/project/backups/release/production-backup.tar.gz' : '/srv/project/backups/release/production-backup.tar.gz');
      await expect(active.getByRole('definition').nth(1)).toHaveText(direction === 'upload' ? '/srv/project/backups/release/production-backup.tar.gz' : '/local/project/backups/release/production-backup.tar.gz');
      await expect(active.getByText('1.0 MB/s')).toBeVisible();
      await expect(active.getByText('约剩余 5 秒')).toBeVisible();
      await expect(manager.getByRole('alert')).toContainText('Permission denied');
      for (const width of [420, 200]) {
        const handle = (await page.getByTestId('resize-handle-files').boundingBox())!;
        const before = (await manager.boundingBox())!;
        await page.mouse.move(handle.x + handle.width / 2, handle.y + 60);
        await page.mouse.down();
        await page.mouse.move(handle.x + handle.width / 2 - width + before.width, handle.y + 60, { steps: 8 });
        await page.mouse.up();
        await expect.poll(async () => Math.round((await manager.boundingBox())!.width)).toBe(width);
        expect(await manager.locator('.transfer-manager-body').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
        for (const card of await manager.getByRole('article').all()) {
          const overflow = await card.evaluate(element => element.scrollWidth - element.clientWidth);
          expect(overflow).toBeLessThanOrEqual(1);
          const bounds = (await card.boundingBox())!;
          for (const button of await card.getByRole('button').all()) {
            const box = (await button.boundingBox())!;
            expect(box.x).toBeGreaterThanOrEqual(bounds.x);
            expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
          }
        }
        await manager.screenshot({ path: info.outputPath(`${direction}-${theme}-${width}.png`) });
      }
      await active.getByRole('button', { name: '暂停', exact: true }).click();
      await expect(active.getByRole('button', { name: '继续传输', exact: true })).toBeVisible();
      await manager.getByTestId('downloads-clear').click();
      await page.getByRole('dialog').getByRole('button', { name: '清空已完成记录', exact: true }).click();
      await expect(manager.getByRole('region', { name: '已完成', exact: true })).toHaveCount(0);
      await expect(active).toBeVisible();
      await expect(manager.getByTestId('transfer-failed')).toBeVisible();
    });
  }
}

test('empty transfer pages explain where to start and return to file browsing', async ({ page }, info) => {
  await setupTauriMock(page);
  await page.goto('/');
  await page.locator('[data-dock-btn="files"]').click();
  for (const direction of ['upload', 'download'] as const) {
    await page.getByTestId('local-more-btn').click();
    await page.getByRole('button', { name: direction === 'upload' ? '上传管理' : '下载管理', exact: true }).click();
    const manager = page.getByTestId(`${direction}-manager`);
    await expect(manager.getByText('暂无传输记录', { exact: true })).toBeVisible();
    await expect(manager.getByText(direction === 'upload' ? /在远程文件面板上传文件或文件夹后/ : /在远程文件面板下载文件或文件夹后/)).toBeVisible();
    await manager.screenshot({ path: info.outputPath(`${direction}-empty.png`) });
    await manager.getByRole('button', { name: '返回文件浏览', exact: true }).last().click();
    await expect(page.getByTestId('local-more-btn')).toBeVisible();
  }
});
