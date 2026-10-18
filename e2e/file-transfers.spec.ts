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
  await page.mouse.move(x + 220, y, { steps: 8 }); await page.mouse.up();
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
  await page.locator('[data-dock-btn="files"]').click();
  const row = page.getByTestId('local-file-tree').locator('[data-path="/home/e2e/notes.txt"]');
  await row.click({ button: 'right' });
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('应用撤销已关闭');
});
