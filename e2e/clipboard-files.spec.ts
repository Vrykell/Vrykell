import { test, expect } from '@playwright/test';
import { clipboardFiles, setupTauriMock } from './tauri-mock';

/** Copying or cutting a row must also put the real path on the system file clipboard. */
test('copying and cutting a file row writes the real path to the system clipboard', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await page.locator('[data-dock-btn="files"]').click();

  const tree = page.getByTestId('local-file-tree');
  const row = tree.locator('[data-testid="file-row"]').first();
  const path = await row.getAttribute('data-path');
  expect(path).toBeTruthy();

  await row.click();
  await page.keyboard.press('Control+c');
  await expect.poll(() => clipboardFiles(page)).toEqual({ paths: [path], mode: 'copy' });

  await page.keyboard.press('Control+x');
  await expect.poll(() => clipboardFiles(page)).toEqual({ paths: [path], mode: 'cut' });
});
