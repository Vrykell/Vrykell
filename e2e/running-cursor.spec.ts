import { test, expect } from '@playwright/test';
import { setupTauriMock, emitPtyOutput } from './tauri-mock';

/**
 * A running block's live cursor must stay visible when the command input takes focus
 * (for example after pasting the next command). The default inactive outline is a
 * hairline that reads as a vanished cursor on Retina displays, so the terminal keeps a
 * solid block instead. The DOM renderer is forced so the cursor cell is inspectable.
 */
test('a running block keeps a solid cursor after the command input takes focus', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('vrykell-typography', JSON.stringify({ version: 0, state: { terminalRenderer: 'dom', terminalCursorBlink: true } }));
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
  const composer = page.locator('[data-chat-composer]:visible');
  await composer.click();
  await composer.fill('echo next');
  await expect(composer).toBeFocused();
  await expect(page.getByTestId('running-term').locator('.xterm')).toBeVisible();

  // The cursor stays a solid block instead of turning into an invisible outline.
  await expect.poll(cursorClass).toContain('xterm-cursor-block');
  await expect.poll(cursorClass).not.toContain('xterm-cursor-outline');
});

/**
 * A program can request a blinking cursor shape. With the blink preference off the
 * shape must still follow the request, but the blink animation must stay disabled so
 * typing does not make the cursor flash on every redraw.
 */
test('with blinking disabled, a program cursor blink request only changes the shape', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('vrykell-typography', JSON.stringify({ version: 0, state: { terminalRenderer: 'dom', terminalCursorBlink: false } }));
  });
  await setupTauriMock(page);
  await page.goto('/');
  const input = page.getByPlaceholder(/输入命令/);
  await expect(input).toBeVisible({ timeout: 5000 });

  await emitPtyOutput(page, `\x1b]133;E;${btoa('sleep 100')}\x07\x1b]133;C\x07`);
  await expect(page.getByTestId('running-term').locator('.xterm')).toBeVisible({ timeout: 5000 });
  await page.waitForFunction(() => document.activeElement?.classList.contains('xterm-helper-textarea'));

  const cursorClass = () => page.evaluate(() => {
    const map = (window as unknown as { __vrykellTerms: Map<string, { element?: HTMLElement }> }).__vrykellTerms;
    const key = [...map.keys()].find((candidate) => candidate.startsWith('block:'));
    const cell = map.get(key!)?.element?.querySelector('[class*="xterm-cursor"]');
    return cell?.className ?? '';
  });
  await expect.poll(cursorClass).not.toContain('xterm-cursor-blink');

  // Blinking bar request: the shape applies, the blink bit does not.
  await emitPtyOutput(page, '\x1b[5 q');
  await expect.poll(cursorClass).toContain('xterm-cursor-bar');
  await expect.poll(cursorClass).not.toContain('xterm-cursor-blink');

  // A later redraw (the typing path) must not restart a blink either.
  await emitPtyOutput(page, 'x');
  await expect.poll(cursorClass).toContain('xterm-cursor-bar');
  await expect.poll(cursorClass).not.toContain('xterm-cursor-blink');
});
