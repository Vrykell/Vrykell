import { test, expect } from '@playwright/test';
import { setupTauriMock, emitPtyOutput } from './tauri-mock';

/**
 * A running block's live cursor must stay visible when the command input takes focus
 * (for example after pasting the next command). The default inactive outline is a
 * hairline that reads as a vanished cursor on Retina displays, so the terminal keeps a
 * solid block instead. The DOM renderer is forced so the cursor cell is inspectable.
 */
test('运行中块在命令输入框获得焦点后仍保持实心光标', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('vrykell-typography', JSON.stringify({ version: 0, state: { terminalRenderer: 'dom' } }));
  });
  await setupTauriMock(page);
  await page.goto('/');
  const input = page.getByPlaceholder(/输入命令/);
  await expect(input).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.terminal-branch')).toHaveText('main');

  await emitPtyOutput(page, `\x1b]133;E;${btoa('sleep 100')}\x07\x1b]133;C\x07`);
  await expect(page.getByTestId('running-term').locator('.xterm')).toBeVisible({ timeout: 5000 });

  const cursorClass = () => page.evaluate(() => {
    const map = (window as unknown as { __vrykellTerms: Map<string, { element?: HTMLElement }> }).__vrykellTerms;
    const key = [...map.keys()].find((candidate) => candidate.startsWith('block:'));
    const cell = map.get(key!)?.element?.querySelector('[class*="xterm-cursor"]');
    return cell?.className ?? '';
  });

  // Focused on the running terminal: a blinking block.
  await page.waitForFunction(() => document.activeElement?.classList.contains('xterm-helper-textarea'));
  await expect.poll(cursorClass).toContain('xterm-cursor-blink');
  await expect.poll(cursorClass).toContain('xterm-cursor-block');

  // Focus another input: the AI panel composer (the terminal command composer is not
  // available while a command owns the running scene). Focus leaves the running terminal.
  await page.locator('[data-dock-btn="chat"]').click();
  const composer = page.locator('[data-chat-composer]');
  await composer.click();
  await composer.fill('echo next');
  await expect(composer).toBeFocused();
  await expect(page.getByTestId('running-term').locator('.xterm')).toBeVisible();

  // The cursor stays a solid block instead of turning into an invisible outline.
  await expect.poll(cursorClass).toContain('xterm-cursor-block');
  await expect.poll(cursorClass).not.toContain('xterm-cursor-outline');
});
