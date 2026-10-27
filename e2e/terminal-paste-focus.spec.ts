import { test, expect, type Page } from '@playwright/test';
import { setupTauriMock, emitPtyOutput, ptyWrites } from './tauri-mock';

async function ready(page: Page) {
  await setupTauriMock(page); await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await page.waitForFunction(async () => {
    const path = '/src/features/terminal/stores/terminal.ts';
    const { useTerminalStore } = await import(path) as typeof import('../src/features/terminal/stores/terminal');
    return Object.values(useTerminalStore.getState().startupStates).includes('ready');
  });
}

async function switchBack(page: Page) {
  const original = await page.evaluate(async () => {
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    const id = useWorkspaceStore.getState().activeId;
    useWorkspaceStore.getState().addTab();
    return id;
  });
  await expect(page.getByTestId('tui-banner')).not.toBeVisible();
  await page.locator(`[data-tab-row-id="${original}"]`).click();
}

test('returning to TUI focuses its input and image paste reaches the foreground process', async ({ page }) => {
  await ready(page);
  // Bracketed paste on (what real CLIs request): the image key must still reach the PTY raw —
  // term.paste() would wrap it in \x1b[200~…\x1b[201~ and the program would read text, not a key.
  await emitPtyOutput(page, '\x1b]133;E;dm0=\x07\x1b]133;C\x07\x1b[?1049;2004hTUI');
  await expect(page.getByTestId('tui-banner')).toBeVisible();
  await switchBack(page);
  const input = page.locator('.xterm:visible .xterm-helper-textarea').first();
  await expect(input).toBeFocused();
  await page.evaluate(() => { (window as unknown as { __CLIPBOARD_IMAGE__: boolean }).__CLIPBOARD_IMAGE__ = true; });
  for (const shortcut of ['Control+v', 'Meta+v']) {
    const before = (await ptyWrites(page)).length;
    await page.keyboard.press(shortcut);
    await expect.poll(async () => (await ptyWrites(page)).slice(before)).toEqual(['\x16']);
  }
});

test('returning to a running block focuses it immediately and keeps normal text paste', async ({ page }) => {
  await ready(page);
  await emitPtyOutput(page, '\x1b]133;E;c2xlZXA=\x07\x1b]133;C\x07running');
  await expect(page.getByTestId('running-term')).toBeVisible();
  await switchBack(page);
  const input = page.locator('[data-testid="running-term"]:visible .xterm-helper-textarea');
  await expect(input).toBeFocused();
  await page.evaluate(() => { (window as unknown as { __CLIPBOARD_TEXT__: string }).__CLIPBOARD_TEXT__ = 'pasted'; });
  const before = (await ptyWrites(page)).length;
  await page.keyboard.press('Control+v');
  await expect.poll(async () => (await ptyWrites(page)).slice(before)).toEqual(['pasted']);
});

test('returning to an idle session focuses command input', async ({ page }) => {
  await ready(page); await switchBack(page);
  await expect(page.locator('[data-terminal-input]:visible')).toBeFocused();
});

test('opening chat does not autofocus it, and switching sessions still focuses terminal input', async ({ page }) => {
  await ready(page);
  await page.locator('[data-dock-btn="chat"]').click();
  const composer = page.locator('[data-chat-composer]:visible');
  await expect(composer).toBeVisible();
  await expect(composer).not.toBeFocused();
  await switchBack(page);
  await expect(page.locator('[data-terminal-input]:visible')).toBeFocused();
  await expect(composer).not.toBeFocused();
});
