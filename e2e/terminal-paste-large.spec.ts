import { test, expect, type Page } from '@playwright/test';
import { setupTauriMock, emitPtyOutput, ptyWrites } from './tauri-mock';

/**
 * Mount the app with the local shell in the classic scene: the prompt runs whatever a paste
 * contains, which is exactly the case the confirmation protects. The default block scene keeps
 * keyboard input in the command bar, so its xterm never sees a shortcut.
 */
async function openClassicShell(page: Page) {
  await page.addInitScript(() => localStorage.setItem('vrykell-agent-settings', JSON.stringify({
    version: 8,
    state: { global: { openModeByShell: { zsh: 'classic' } }, overrides: {} },
  })));
  await setupTauriMock(page);
  await page.goto('/');
  // The classic scene has no command bar to wait for: the ready PTY session is the signal.
  await page.waitForFunction(async () => {
    const path = '/src/features/terminal/stores/terminal.ts';
    const { useTerminalStore } = await import(path) as typeof import('../src/features/terminal/stores/terminal');
    return Object.keys(useTerminalStore.getState().sessions).length > 0;
  });
}

const terminalInput = (page: Page) => page.locator('.terminal-pane:visible .xterm-helper-textarea').first();

/** A representative seven-line script, including its trailing newline. */
const MULTI_LINE = 'one\ntwo\nthree\nfour\nfive\nsix\n';

const seedClipboard = (page: Page, text: string) => page.evaluate((value) => {
  (window as unknown as Record<string, string>).__CLIPBOARD_TEXT__ = value;
}, text);

test('经典场景多行粘贴先确认：取消不写入，确认后按行尾归一化写入', async ({ page }) => {
  await openClassicShell(page);
  await seedClipboard(page, MULTI_LINE);

  const before = (await ptyWrites(page)).length;
  await terminalInput(page).press('Control+v');
  const dialog = page.getByTestId('confirm-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('7 行');
  expect((await ptyWrites(page)).slice(before)).toEqual([]);

  await page.getByTestId('confirm-cancel').click();
  await expect(dialog).toBeHidden();
  expect((await ptyWrites(page)).slice(before)).toEqual([]);

  await terminalInput(page).press('Control+v');
  await expect(dialog).toBeVisible();
  await page.getByTestId('confirm-ok').click();
  // The terminal paste path normalizes every line ending to CR before the write.
  await expect.poll(async () => (await ptyWrites(page)).slice(before))
    .toEqual(['one\rtwo\rthree\rfour\rfive\rsix\r']);
});

test('前台程序开启 bracketed paste 后多行粘贴不再确认且保持包裹', async ({ page }) => {
  await openClassicShell(page);
  await emitPtyOutput(page, '\x1b[?2004h');
  await expect.poll(() => page.evaluate(() => {
    const terms = (window as unknown as { __vrykellTerms: Map<string, { modes?: { bracketedPasteMode?: boolean } }> }).__vrykellTerms;
    return [...terms.values()].some((term) => term.modes?.bracketedPasteMode === true);
  })).toBe(true);

  await seedClipboard(page, MULTI_LINE);
  const before = (await ptyWrites(page)).length;
  await terminalInput(page).press('Control+v');
  await expect.poll(async () => (await ptyWrites(page)).slice(before))
    .toEqual(['\x1b[200~one\rtwo\rthree\rfour\rfive\rsix\r\x1b[201~']);
  await expect(page.getByTestId('confirm-dialog')).toBeHidden();
});

test('超过 64K 字符的粘贴先确认，确认后分块送达完整内容', async ({ page }) => {
  await openClassicShell(page);
  const large = 'x'.repeat(64 * 1024 + 8);
  await seedClipboard(page, large);

  const before = (await ptyWrites(page)).length;
  await terminalInput(page).press('Control+v');
  const dialog = page.getByTestId('confirm-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`${large.length} 个字符`);

  await page.getByTestId('confirm-ok').click();
  await expect.poll(async () => (await ptyWrites(page)).slice(before).join('').length).toBe(large.length);
  const chunks = (await ptyWrites(page)).slice(before);
  // One PTY write carries at most 16K code units, and the chunks reassemble to the paste.
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.every((chunk) => chunk.length <= 16 * 1024)).toBe(true);
  expect(chunks.join('')).toBe(large);
});

test('运行中块的多行粘贴同样先确认', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
  await emitPtyOutput(page, `\x1b]133;E;${btoa('sleep 100')}\x07\x1b]133;C\x07`);
  const host = page.getByTestId('running-term');
  await expect(host.locator('.xterm')).toBeVisible();
  await seedClipboard(page, MULTI_LINE);

  const before = (await ptyWrites(page)).length;
  await host.locator('.xterm-helper-textarea').press('Control+v');
  const dialog = page.getByTestId('confirm-dialog');
  await expect(dialog).toBeVisible();

  await page.getByTestId('confirm-ok').click();
  await expect.poll(async () => (await ptyWrites(page)).slice(before))
    .toEqual(['one\rtwo\rthree\rfour\rfive\rsix\r']);
});
