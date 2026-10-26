import { expect, test } from '@playwright/test';
import { setupTauriMock, mockAnthropic, ensureChatSettingsOpen, ptyWrites, emitPtyOutput, windowFrameCalls } from './tauri-mock';
import { gotoSetting } from './settings';
import { formatCommandSubmission } from '../src/features/terminal/model/commandSubmission';

test('an AI multiline script enters its terminal draft and runs only after an explicit Enter', async ({ page }, info) => {
  const script = "cat <<'END' > sample.txt\nfirst line\nsecond line\nEND\necho done";
  await mockAnthropic(page, `\`\`\`bash\n${script}\n\`\`\``);
  await setupTauriMock(page);
  await page.goto('/');
  await page.getByTestId('tab-new-btn').click();
  await page.getByRole('button', { name: /Bash/ }).click();
  await page.locator('[data-dock-btn="chat"]').click();
  await ensureChatSettingsOpen(page);
  await page.getByRole('combobox', { name: '选择执行终端' }).click();
  await page.getByRole('listbox', { name: '选择执行终端' }).getByRole('option').filter({ hasText: 'Bash' }).click();
  await page.locator('[data-chat-composer]').fill('Show the script');
  await page.locator('[data-chat-composer]').press('Enter');
  const run = page.locator('.chat-exchange:visible').last().getByRole('button', { name: '在终端运行', exact: true });
  await expect(run).toBeVisible();
  const before = (await ptyWrites(page)).length;
  await page.keyboard.press('Escape'); await run.click();
  const input = page.locator('[data-terminal-input]:visible');
  await expect(input).toHaveValue(script);
  await expect(input).toBeFocused();
  expect((await ptyWrites(page)).slice(before)).toEqual([]);
  await page.screenshot({ path: info.outputPath('script-awaiting-enter.png') });
  await input.press('Enter');
  await expect.poll(async () => (await ptyWrites(page)).slice(before)).toEqual([formatCommandSubmission(script, 'posix')]);
});

test('PowerShell multiline transport stays out of the visible command and output', async ({ page }) => {
  test.skip(process.platform !== 'win32', 'Requires the Windows PowerShell path.');
  await setupTauriMock(page, { shells: [{ id: 'powershell', label: 'Windows PowerShell', default: true }] });
  await page.goto('/');
  const input = page.locator('[data-terminal-input]:visible');
  await expect(input).toBeVisible();
  await emitPtyOutput(page, '\x1b]133;A\x07');

  const script = "Write-Output '中文'\nWrite-Output 'done'";
  await input.fill(script);
  const before = (await ptyWrites(page)).length;
  await input.press('Enter');
  await expect.poll(async () => (await ptyWrites(page)).slice(before).join('')).toContain('Invoke-Expression');
  const payload = (await ptyWrites(page)).slice(before).join('').trimEnd();
  const encoded = Buffer.from(payload, 'utf8').toString('base64');
  await emitPtyOutput(page, `${payload}\r\n\x1b]133;E;${encoded}\x07\x1b]133;C\x07中文\r\ndone\r\n\x1b]133;D;0\x07\x1b]133;A\x07`);

  const block = page.locator('[data-testid^="command-block-"]').last();
  await expect(block.locator('.command-block-command')).toContainText("Write-Output '中文'");
  await expect(block.locator('.command-block-command')).not.toContainText('Invoke-Expression');
  await expect(block.locator('.command-block-output')).toContainText('中文');
  await expect(block.locator('.command-block-output')).not.toContainText('Invoke-Expression');
});

test('pasting a multiline script from the idle terminal menu preserves it without execution', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  const input = page.locator('[data-terminal-input]:visible');
  await expect(input).toBeVisible();
  await page.evaluate(() => { (window as unknown as { __CLIPBOARD_TEXT__: string }).__CLIPBOARD_TEXT__ = 'echo one\necho two\n'; });
  const before = (await ptyWrites(page)).length;
  await page.locator('.terminal-pane:visible').first().click({ button: 'right' });
  await page.getByRole('menu', { name: '操作菜单' }).getByRole('button', { name: /粘贴/ }).click();
  await expect(input).toHaveValue('echo one\necho two\n');
  expect((await ptyWrites(page)).slice(before)).toEqual([]);
  await expect(page.getByTestId('confirm-dialog')).toBeHidden();
});

test('a native paste with even one trailing newline asks before writing to an unprotected process', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.locator('[data-terminal-input]:visible')).toBeVisible();
  await emitPtyOutput(page, '\x1b]133;E;c2xlZXA=\x07\x1b]133;C\x07running');
  const input = page.getByTestId('running-term').locator('.xterm-helper-textarea');
  await expect(input).toBeAttached();
  const before = (await ptyWrites(page)).length;
  const paste = () => input.evaluate(element => {
    const data = new DataTransfer(); data.setData('text/plain', 'echo pasted\n');
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await paste();
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  expect((await ptyWrites(page)).slice(before)).toEqual([]);
  await page.getByTestId('confirm-cancel').click();
  expect((await ptyWrites(page)).slice(before)).toEqual([]);
  await paste();
  await page.getByTestId('confirm-ok').click();
  await expect.poll(async () => (await ptyWrites(page)).slice(before)).toEqual(['echo pasted\r']);
});

test('the native window border follows the neutral gray theme border', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect.poll(async () => (await windowFrameCalls(page)).at(-1)?.color).toBe('#4B4E52');
  await gotoSetting(page, '主题');
  await page.getByRole('radio', { name: '浅色', exact: true }).click();
  await expect.poll(async () => (await windowFrameCalls(page)).at(-1)?.color).toBe('#B9C2C8');
});
