import { expect, test } from '@playwright/test';
import { ptyWrites, setupTauriMock } from './tauri-mock';

/**
 * An older shell hook (or a shell that never sends 133;B) must not leave file-open commands
 * queued forever: once output has stopped for a while, input should count as ready and the
 * command is written as usual.
 *
 * Files open in the editor page by default, so the preference is set back to the terminal editor
 * here; the test covers the readiness fallback of the terminal write.
 */
const useTerminalOpen = async (page: import('@playwright/test').Page) => {
  await page.addInitScript(() => {
    localStorage.setItem('vrykell-editor-preferences', JSON.stringify({
      state: { pageMode: 'single', localOpenMode: 'terminal', remoteOpenMode: 'terminal' }, version: 0,
    }));
  });
};

test('a shell without the ready marker still receives the file-open command', async ({ page }) => {
  await useTerminalOpen(page);
  await setupTauriMock(page, { shellReadyMarker: false });
  await page.goto('/');
  await page.locator('[data-dock-btn="files"]').click();
  await expect(page.getByText('notes.txt')).toBeVisible();

  await page.getByText('notes.txt').dblclick();

  await expect.poll(() => ptyWrites(page), { timeout: 8000 }).toContain('vim /home/e2e/notes.txt\n');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a ready-marked shell keeps the fast path', async ({ page }) => {
  await useTerminalOpen(page);
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
