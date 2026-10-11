import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test('restores the saved directory of a legacy local terminal session', async ({ page }) => {
  await setupTauriMock(page);
  await page.addInitScript(() => {
    const internals = window as unknown as {
      __TAURI_INTERNALS__: { invoke(command: string, args: Record<string, unknown>): Promise<unknown> };
    };
    const invoke = internals.__TAURI_INTERNALS__.invoke;
    internals.__TAURI_INTERNALS__.invoke = async (command, args) => {
      const result = await invoke(command, args);
      if (command === 'get_session') return { ...(result as Record<string, unknown>), cwd: '/saved/project', payload: '{}' };
      return result;
    };
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __PTY_SPAWNS__: { cwd?: string }[] }).__PTY_SPAWNS__.map((spawn) => spawn.cwd),
  )).toContain('/saved/project');
});
