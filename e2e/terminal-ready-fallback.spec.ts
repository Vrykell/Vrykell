import { expect, test } from '@playwright/test';
import { ptyWrites, setupTauriMock } from './tauri-mock';

/**
 * 老版本 shell 钩子（或未发送 133;B 的 shell）不能让文件打开命令永远排队：
 * 输出停止一段时间后应把输入视为就绪，并照常写入命令。
 */
test('a shell without the ready marker still receives the file-open command', async ({ page }) => {
  await setupTauriMock(page, { shellReadyMarker: false });
  await page.goto('/');
  await page.locator('[data-dock-btn="files"]').click();
  await expect(page.getByText('notes.txt')).toBeVisible();

  await page.getByText('notes.txt').dblclick();

  await expect.poll(() => ptyWrites(page), { timeout: 8000 }).toContain('vim /home/e2e/notes.txt\n');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a ready-marked shell keeps the fast path', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await page.locator('[data-dock-btn="files"]').click();
  await expect(page.getByText('notes.txt')).toBeVisible();

  const started = Date.now();
  await page.getByText('notes.txt').dblclick();
  await expect.poll(() => ptyWrites(page), { timeout: 8000 }).toContain('vim /home/e2e/notes.txt\n');
  // The marker path adds only the repaint grace, so it must stay well below the idle fallback.
  expect(Date.now() - started).toBeLessThan(2000);
});
