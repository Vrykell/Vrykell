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

test('终端右键菜单提供复制/粘贴并标注 Ctrl+C/V', async ({ page }) => {
  await page.locator('[data-testid^="pane-"]').first().click({ button: 'right' });
  const menu = page.getByRole('menu', { name: '操作菜单' });
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('复制');
  // Modifier keys render as glyphs; the accessible name carries the shortcut.
  await expect(menu.getByLabel('Control+C')).toBeVisible();
  await expect(menu).toContainText('粘贴');
  await expect(menu.getByLabel('Control+V')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('terminal-clipboard-menu.png') });
});

test('运行中块 Ctrl+V 把剪贴板内容写入 PTY', async ({ page }) => {
  const host = await startRunningBlock(page);
  await page.evaluate(() => {
    (window as unknown as Record<string, string>).__CLIPBOARD_TEXT__ = 'echo pasted\n';
  });

  const before = (await ptyWrites(page)).length;
  await host.locator('.xterm-helper-textarea').press('Control+v');
  // The terminal paste path normalizes line endings to CR before the PTY write.
  await expect.poll(async () => (await ptyWrites(page)).slice(before)).toContain('echo pasted\r');
});

test('会话请求 win32-input-mode 后 Ctrl+C 仍然复制而不是发按键记录', async ({ page }) => {
  await emitPtyOutput(page, `\x1b]133;E;${btoa('sleep 100')}\x07\x1b]133;C\x07`);
  await emitPtyOutput(page, '\x1b[?9001h\x1b[2;1Hcopyme');
  const host = page.getByTestId('running-term');
  await expect(host.locator('.xterm')).toBeVisible();
  await expect.poll(() => hasBlockTerm(page)).toBe(true);
  await selectInBlockTerm(page, 0, 1, 6);

  const before = (await ptyWrites(page)).length;
  await host.locator('.xterm-helper-textarea').press('Control+c');
  await expect.poll(() => clipboardText(page)).toBe('copyme');
  // 复制分支必须在按键编码之前：否则会话拿到的是 ^C 记录，复制失效
  expect((await ptyWrites(page)).slice(before)).not.toContain('_');
});

test('运行中块 Ctrl+Shift+C 把选区写入剪贴板', async ({ page }) => {
  await emitPtyOutput(page, `\x1b]133;E;${btoa('echo copy-me')}\x07\x1b]133;C\x07`);
  await emitPtyOutput(page, '\x1b[2;1Hcopyme');
  const host = page.getByTestId('running-term');
  await expect(host.locator('.xterm')).toBeVisible();

  await expect.poll(() => hasBlockTerm(page)).toBe(true);
  await selectInBlockTerm(page, 0, 1, 6);

  await host.locator('.xterm-helper-textarea').press('Control+Shift+C');
  await expect.poll(() => clipboardText(page)).toBe('copyme');
});

test('有选区时 Ctrl+C 复制而不是把中断发进终端', async ({ page }) => {
  await emitPtyOutput(page, `\x1b]133;E;${btoa('echo copy-me')}\x07\x1b]133;C\x07`);
  await emitPtyOutput(page, '\x1b[2;1Hcopyme');
  const host = page.getByTestId('running-term');
  await expect(host.locator('.xterm')).toBeVisible();
  await expect.poll(() => hasBlockTerm(page)).toBe(true);
  await selectInBlockTerm(page, 0, 1, 6);

  const before = (await ptyWrites(page)).length;
  await host.locator('.xterm-helper-textarea').press('Control+c');
  await expect.poll(() => clipboardText(page)).toBe('copyme');
  // 有选区时是复制：不能再把 ^C 写进 PTY（否则就是「选中后 Ctrl+C 中断了命令」）
  expect((await ptyWrites(page)).slice(before)).not.toContain('\x03');

  // 没有选区时仍是终端中断
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
