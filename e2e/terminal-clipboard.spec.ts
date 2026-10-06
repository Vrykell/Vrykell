import { test, expect } from '@playwright/test';
import { setupTauriMock, emitPtyOutput, ptyWrites, clipboardText } from './tauri-mock';

async function startRunningBlock(page: import('@playwright/test').Page) {
  await emitPtyOutput(page, `\x1b]133;E;${btoa('sleep 100')}\x07\x1b]133;C\x07`);
  const host = page.getByTestId('running-term');
  await expect(host.locator('.xterm')).toBeVisible();
  return host;
}

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
});

test('终端右键菜单提供复制/粘贴并标注 Ctrl+Shift+C/V', async ({ page }) => {
  await page.locator('[data-testid^="pane-"]').first().click({ button: 'right' });
  const menu = page.getByRole('menu', { name: '操作菜单' });
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('复制');
  await expect(menu).toContainText('Ctrl+Shift+C');
  await expect(menu).toContainText('粘贴');
  await expect(menu).toContainText('Ctrl+Shift+V');
  await page.screenshot({ path: test.info().outputPath('terminal-clipboard-menu.png') });
});

test('运行中块 Ctrl+Shift+V 把剪贴板内容写入 PTY', async ({ page }) => {
  const host = await startRunningBlock(page);
  await page.evaluate(() => {
    (window as unknown as Record<string, string>).__CLIPBOARD_TEXT__ = 'echo pasted\n';
  });

  const before = (await ptyWrites(page)).length;
  await host.locator('.xterm-helper-textarea').press('Control+Shift+V');
  await expect.poll(async () => (await ptyWrites(page)).slice(before)).toContain('echo pasted\n');
});

test('运行中块 Ctrl+Shift+C 把选区写入剪贴板', async ({ page }) => {
  await emitPtyOutput(page, `\x1b]133;E;${btoa('echo copy-me')}\x07\x1b]133;C\x07`);
  await emitPtyOutput(page, '\x1b[2;1Hcopyme');
  const host = page.getByTestId('running-term');
  await expect(host.locator('.xterm')).toBeVisible();

  const hasBlockTerm = () => page.evaluate(() => {
    const map = (window as unknown as { __vrykellTerms?: Map<string, unknown> }).__vrykellTerms;
    return Boolean(map && [...map.keys()].some((key) => key.startsWith('block:')));
  });
  await expect.poll(hasBlockTerm).toBe(true);

  await page.evaluate(() => {
    const map = (window as unknown as {
      __vrykellTerms?: Map<string, { select: (column: number, row: number, length: number) => void }>;
    }).__vrykellTerms!;
    const key = [...map.keys()].find((candidate) => candidate.startsWith('block:'))!;
    map.get(key)!.select(0, 1, 6);
  });

  await host.locator('.xterm-helper-textarea').press('Control+Shift+C');
  await expect.poll(() => clipboardText(page)).toBe('copyme');
});
