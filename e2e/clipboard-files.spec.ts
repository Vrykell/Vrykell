import { test, expect } from '@playwright/test';
import { clipboardFiles, openedPaths, setupTauriMock } from './tauri-mock';

test('opens supported text internally and unsupported files with the system application', async ({ page }) => {
  await setupTauriMock(page);
  await page.addInitScript(() => {
    (window as unknown as { __FS_EXTRA_ENTRIES__: unknown[] }).__FS_EXTRA_ENTRIES__ = [
      { name: 'report.pdf', path: '/home/e2e/report.pdf', is_dir: false },
    ];
  });
  await page.goto('/'); await page.locator('[data-dock-btn="files"]').click();
  await page.getByTestId('local-file-tree').getByTestId('file-row').filter({ hasText: 'report.pdf' }).dblclick();
  await expect.poll(() => openedPaths(page)).toEqual(['/home/e2e/report.pdf']);
  await expect(page.getByTestId('file-editor')).toHaveCount(0);
  await page.getByTestId('local-file-tree').getByTestId('file-row').filter({ hasText: 'notes.txt' }).dblclick();
  await expect(page.getByTestId('file-editor').locator('.monaco-editor')).toBeVisible();
});

for (const theme of ['dark', 'light']) test(`file rows match command selection and density in ${theme}`, async ({ page }, info) => {
  await setupTauriMock(page);
  await page.addInitScript(theme => {
    localStorage.setItem('vrykell-theme-mode', theme);
    localStorage.setItem('mock-command-history-runs', JSON.stringify([
      { id: 'layout-sample', target: 'local', shell: 'system', command: 'git status', cwd: '/home/e2e/project', status: 'success', exitCode: 0, timestamp: 3000, runCount: 1 },
    ]));
  }, theme);
  await page.goto('/');
  await page.getByRole('button', { name: '历史命令', exact: true }).click();
  const command = page.getByTestId('command-history-layout-sample');
  await expect(command).toBeVisible();
  await command.click();
  const commandSurface = command.locator('.sidebar-row-content');
  const selectedColor = await page.evaluate(() => {
    const probe = document.createElement('i');
    probe.style.background = 'var(--selection-bg)'; document.body.appendChild(probe);
    const color = getComputedStyle(probe).backgroundColor; probe.remove(); return color;
  });
  await expect(commandSurface).toHaveCSS('background-color', selectedColor);
  const reference = await commandSurface.evaluate(element => ({
    height: element.getBoundingClientRect().height,
    radius: getComputedStyle(element).borderRadius,
  }));
  await page.locator('[data-dock-btn="files"]').click();
  const tree = page.getByTestId('local-file-tree');
  const rows = tree.locator('[data-testid="file-row"]');
  const row = rows.first();
  await row.click();
  await expect(row).toHaveAttribute('data-selected', 'true');
  await expect(row).toHaveCSS('border-radius', reference.radius);
  await expect(row).toHaveCSS('background-color', selectedColor);
  expect((await row.boundingBox())!.height).toBeCloseTo(reference.height, 1);
  await row.hover();
  await expect(row).toHaveCSS('background-color', selectedColor);
  await page.screenshot({ path: info.outputPath(`file-rows-${theme}.png`), animations: 'disabled' });
  if (await rows.count() > 1) {
    await tree.focus();
    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(1)).toHaveAttribute('data-selected', 'true');
  }
});

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
