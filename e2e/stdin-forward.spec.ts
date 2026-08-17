import { test, expect } from '@playwright/test';
import { setupTauriMock, emitPtyOutput, ptyWrites } from './tauri-mock';

/**
 * 运行中 block 的键盘：焦点交给块卡片内的活 xterm（RunningTerm 挂载），
 * 按键经 xterm 原生 textarea 路径（onData → ptyWrite）进 PTY —— 与 classic
 * 场景同一条输入路径，IME/退格/控制键全部由 xterm 处理。
 */

async function startRunningBlock(page: import('@playwright/test').Page) {
  const input = page.getByPlaceholder(/输入命令/);
  await expect(input).toBeVisible({ timeout: 5000 });
  await emitPtyOutput(page, `\x1b]133;E;${btoa('sleep 100')}\x07\x1b]133;C\x07`);
  await expect(page.getByTitle('终止命令 (Ctrl+C)')).toBeVisible({ timeout: 5000 });
  return input;
}

/** 等焦点收归隐藏 xterm 的 textarea */
async function expectXtermFocused(page: import('@playwright/test').Page) {
  await expect
    .poll(() =>
      page.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea')),
    )
    .toBe(true);
}

test('运行中 block：键盘经 xterm 原生路径进 PTY（含退格，End 保留）', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  const input = await startRunningBlock(page);

  const before = (await ptyWrites(page)).length;

  // 焦点在输入框时：按键进输入框（typeahead），不转发
  await input.click();
  await page.keyboard.type('xy');
  expect((await ptyWrites(page)).length).toBe(before);

  // 焦点离开可编辑元素：自动收归隐藏 xterm，按键经 xterm 翻译进 PTY
  await input.evaluate((el) => (el as HTMLElement).blur());
  await expectXtermFocused(page);
  await page.keyboard.type('ab');
  await page.keyboard.press('Backspace'); // → \x7f（手搓方案丢退格）
  await page.keyboard.press('Control+c'); // → \x03
  await page.keyboard.press('End'); // 保留给「回到输入栏」，不得进 PTY

  const writes = await ptyWrites(page);
  expect(writes.slice(before)).toEqual(['a', 'b', '\x7f', '\x03']);
});

test('运行中 block：中文 IME 提交文本经 xterm 转发', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  const input = await startRunningBlock(page);
  await input.evaluate((el) => (el as HTMLElement).blur());
  await expectXtermFocused(page);

  const before = (await ptyWrites(page)).length;
  // IME 提交（insertText 走 xterm textarea 的 input/composition 路径）
  await page.keyboard.insertText('中文');

  const writes = await ptyWrites(page);
  expect(writes.slice(before)).toEqual(['中文']);
});

test('运行中 block：焦点空闲时自动收归 xterm（IME 首键即有组合落点）', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  const input = await startRunningBlock(page);

  // 输入栏失焦（模拟长运行隐藏后焦点掉到 body）——不按任何键，
  // 焦点也应自动收归 xterm，IME 从首个拼音键就能起组合（根治拼音泄漏）
  await input.evaluate((el) => (el as HTMLElement).blur());
  await expectXtermFocused(page);

  // 直接提交中文：除提交文本外不得有任何字面字符先漏进 PTY
  const before = (await ptyWrites(page)).length;
  await page.keyboard.insertText('你好');
  const writes = await ptyWrites(page);
  expect(writes.slice(before)).toEqual(['你好']);
});
