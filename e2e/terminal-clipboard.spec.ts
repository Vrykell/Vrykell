import { test, expect, type Page } from '@playwright/test';
import { setupTauriMock, emitPtyOutput, ptyWrites, clipboardText } from './tauri-mock';

async function startRunningBlock(page: Page) {
  await emitPtyOutput(page, `\x1b]133;E;${btoa('sleep 100')}\x07\x1b]133;C\x07`);
  const host = page.getByTestId('running-term');
  await expect(host.locator('.xterm')).toBeVisible();
  return host;
}

/** The running block owns its own xterm, registered as `block:<pane>`. */
function hasBlockTerm(page: Page) {
  return page.evaluate(() => {
    const map = (window as unknown as { __vrykellTerms?: Map<string, unknown> }).__vrykellTerms;
    return Boolean(map && [...map.keys()].some((key) => key.startsWith('block:')));
  });
}

/** Select a run of cells in the running block's xterm, as a mouse drag would. */
function selectInBlockTerm(page: Page, column: number, row: number, length: number) {
  return page.evaluate(({ column, row, length }) => {
    const map = (window as unknown as {
      __vrykellTerms?: Map<string, { select: (column: number, row: number, length: number) => void }>;
    }).__vrykellTerms!;
    const key = [...map.keys()].find((candidate) => candidate.startsWith('block:'))!;
    map.get(key)!.select(column, row, length);
  }, { column, row, length });
}

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
});

test('the terminal context menu offers copy/paste and labels Ctrl+C/V', async ({ page }) => {
  await page.locator('.terminal-pane:visible').first().click({ button: 'right' });
  const menu = page.getByRole('menu', { name: '操作菜单' });
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('复制');
  // Modifier keys render as glyphs; the accessible name carries the shortcut.
  await expect(menu.getByLabel('Control+C')).toBeVisible();
  await expect(menu).toContainText('粘贴');
  await expect(menu.getByLabel('Control+V')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('terminal-clipboard-menu.png') });
});

test('Ctrl+V in a running block writes clipboard content to the PTY', async ({ page }) => {
  const host = await startRunningBlock(page);
  await page.evaluate(() => {
    (window as unknown as Record<string, string>).__CLIPBOARD_TEXT__ = 'echo pasted\n';
  });

  const before = (await ptyWrites(page)).length;
  await host.locator('.xterm-helper-textarea').press('Control+v');
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  expect((await ptyWrites(page)).slice(before)).toEqual([]);
  await page.getByTestId('confirm-ok').click();
  // The terminal paste path normalizes line endings to CR before the PTY write.
  await expect.poll(async () => (await ptyWrites(page)).slice(before)).toContain('echo pasted\r');
});

test('Ctrl+C still copies after the session requests win32-input-mode instead of sending a key record', async ({ page }) => {
  await emitPtyOutput(page, `\x1b]133;E;${btoa('sleep 100')}\x07\x1b]133;C\x07`);
  await emitPtyOutput(page, '\x1b[?9001h\x1b[2;1Hcopyme');
  const host = page.getByTestId('running-term');
  await expect(host.locator('.xterm')).toBeVisible();
  await expect.poll(() => hasBlockTerm(page)).toBe(true);
  await selectInBlockTerm(page, 0, 1, 6);

  const before = (await ptyWrites(page)).length;
  await host.locator('.xterm-helper-textarea').press('Control+c');
  await expect.poll(() => clipboardText(page)).toBe('copyme');
  // The copy branch must come before key encoding: otherwise the session receives a ^C record and copying fails
  expect((await ptyWrites(page)).slice(before)).not.toContain('_');
});

test('Ctrl+Shift+C in a running block writes the selection to the clipboard', async ({ page }) => {
  await emitPtyOutput(page, `\x1b]133;E;${btoa('echo copy-me')}\x07\x1b]133;C\x07`);
  await emitPtyOutput(page, '\x1b[2;1Hcopyme');
  const host = page.getByTestId('running-term');
  await expect(host.locator('.xterm')).toBeVisible();

  await expect.poll(() => hasBlockTerm(page)).toBe(true);
  await selectInBlockTerm(page, 0, 1, 6);

  await host.locator('.xterm-helper-textarea').press('Control+Shift+C');
  await expect.poll(() => clipboardText(page)).toBe('copyme');
});

test('with a selection Ctrl+C copies instead of sending an interrupt to the terminal', async ({ page }) => {
  await emitPtyOutput(page, `\x1b]133;E;${btoa('echo copy-me')}\x07\x1b]133;C\x07`);
  await emitPtyOutput(page, '\x1b[2;1Hcopyme');
  const host = page.getByTestId('running-term');
  await expect(host.locator('.xterm')).toBeVisible();
  await expect.poll(() => hasBlockTerm(page)).toBe(true);
  await selectInBlockTerm(page, 0, 1, 6);

  const before = (await ptyWrites(page)).length;
  await host.locator('.xterm-helper-textarea').press('Control+c');
  await expect.poll(() => clipboardText(page)).toBe('copyme');
  // With a selection this is copy: ^C must not be written to the PTY (otherwise "Ctrl+C after selecting interrupts the command")
  expect((await ptyWrites(page)).slice(before)).not.toContain('\x03');

  // Without a selection it is still a terminal interrupt
  await page.evaluate(() => {
    const map = (window as unknown as {
      __vrykellTerms?: Map<string, { clearSelection: () => void }>;
    }).__vrykellTerms!;
    const key = [...map.keys()].find((candidate) => candidate.startsWith('block:'))!;
    map.get(key)!.clearSelection();
  });
  const afterCopy = (await ptyWrites(page)).length;
  await host.locator('.xterm-helper-textarea').press('Control+c');
  await expect.poll(async () => (await ptyWrites(page)).slice(afterCopy)).toContain('\x03');
});
