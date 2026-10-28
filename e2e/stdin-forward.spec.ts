import { test, expect } from '@playwright/test';
import { setupTauriMock, emitPtyOutput, ptyWrites } from './tauri-mock';

/**
 * Keyboard input for a running block: focus goes to the live xterm inside the block card
 * (mounted by RunningTerm), and key presses reach the PTY through xterm's native textarea
 * path (onData → ptyWrite) - the same input path as the classic scene, with IME, backspace
 * and control keys all handled by xterm.
 */

async function startRunningBlock(page: import('@playwright/test').Page) {
  const input = page.getByPlaceholder(/输入命令/);
  await expect(input).toBeVisible({ timeout: 5000 });
  // Finish the initial shell prompt before emitting a foreground command.
  await expect(page.locator('.terminal-branch')).toHaveText('main');
  await emitPtyOutput(page, `\x1b]133;E;${btoa('sleep 100')}\x07\x1b]133;C\x07`);
  await expect(page.locator('[data-tip="终止命令"]')).toBeVisible({ timeout: 5000 });
  return input;
}

/** Wait until focus settles on the hidden xterm's textarea */
async function expectXtermFocused(page: import('@playwright/test').Page) {
  await expect
    .poll(() =>
      page.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea')),
    )
    .toBe(true);
}

test('running block: keys reach the PTY through the native xterm path (backspace included, End reserved)', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  const input = await startRunningBlock(page);

  const before = (await ptyWrites(page)).length;

  // With focus in the input: keys go to the input (typeahead) and are not forwarded
  await input.click();
  await page.keyboard.type('xy');
  expect((await ptyWrites(page)).length).toBe(before);

  // Focus leaves an editable element: it returns to the hidden xterm automatically, and keys reach the PTY through xterm translation
  await input.evaluate((el) => (el as HTMLElement).blur());
  await expectXtermFocused(page);
  await page.keyboard.type('ab');
  await page.keyboard.press('Backspace'); // → \x7f (a hand-rolled approach drops backspace)
  await page.keyboard.press('Control+c'); // → \x03
  await page.keyboard.press('End'); // Reserved for "return to the input bar"; it must not reach the PTY

  const writes = await ptyWrites(page);
  expect(writes.slice(before)).toEqual(['a', 'b', '\x7f', '\x03']);
});

test('running block: committed Chinese IME text is forwarded through xterm', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  const input = await startRunningBlock(page);
  await input.evaluate((el) => (el as HTMLElement).blur());
  await expectXtermFocused(page);

  const before = (await ptyWrites(page)).length;
  // IME commit (insertText goes through the xterm textarea's input/composition path)
  await page.keyboard.insertText('中文');

  const writes = await ptyWrites(page);
  expect(writes.slice(before)).toEqual(['中文']);
});

test('running block: idle focus returns to xterm automatically (the first IME key already has a composition target)', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  const input = await startRunningBlock(page);

  // The input bar loses focus (simulating focus falling to the body after a long-running
  // command is hidden) - without pressing any key, focus still returns to xterm automatically
  // and IME can start composing from the first pinyin key (fixes pinyin leaking)
  await input.evaluate((el) => (el as HTMLElement).blur());
  await expectXtermFocused(page);

  // Commit Chinese directly: no literal characters may leak into the PTY before the committed text
  const before = (await ptyWrites(page)).length;
  await page.keyboard.insertText('你好');
  const writes = await ptyWrites(page);
  expect(writes.slice(before)).toEqual(['你好']);
});
