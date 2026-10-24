import { test, expect } from '@playwright/test';
import { setupTauriMock, emitPtyOutput } from './tauri-mock';

/**
 * An interactive SSH screen renders through the live terminal, so it must use the same
 * blinking block cursor as a local session instead of a thin insertion bar. The DOM
 * renderer is forced so the cursor cell is inspectable.
 */
test('an interactive SSH screen keeps the shared block cursor', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('vrykell-typography', JSON.stringify({ version: 0, state: { terminalRenderer: 'dom' } }));
  });
  await setupTauriMock(page, { integration: false });
  await page.goto('/');
  await page.locator('[data-dock-btn="ssh"]').click();
  await page.getByTestId('ssh-host-actions').click(); await page.getByRole('button', { name: '快速连接', exact: true }).click();
  await page.getByTestId('ssh-form-host').fill('cursor.example.com');
  await page.getByTestId('ssh-form-user').fill('tester');
  await page.getByTestId('ssh-connect-btn').click();
  const screen = page.getByTestId('ssh-terminal-screen');
  await expect(screen).toBeVisible();
  await screen.click();
  await emitPtyOutput(page, '\x1b[2J\x1b[Hcursor-check');
  await expect(screen.locator('.xterm-screen')).toBeVisible();

  const cursorClass = () => page.evaluate(() => {
    const host = document.querySelector('[data-testid="ssh-terminal-screen"]');
    return host?.querySelector('[class*="xterm-cursor"]')?.className ?? '';
  });
  await expect.poll(cursorClass).toContain('xterm-cursor-block');
  await expect.poll(cursorClass).not.toContain('xterm-cursor-bar');
});
