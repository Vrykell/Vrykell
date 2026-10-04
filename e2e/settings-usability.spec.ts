import { test, expect } from '@playwright/test';
import { setupTauriMock, mockAnthropic, searchCalls, ptyWrites, ptyResizes } from './tauri-mock';
import { gotoSetting } from './settings';

test('saved custom Anthropic address is used by the next chat request', async ({ page }) => {
  await setupTauriMock(page);
  await mockAnthropic(page, '地址设置已生效');
  await page.goto('/');
  await gotoSetting(page, '模型配置');
  const card = page.getByPlaceholder('模型名称').first().locator('xpath=../..');
  await card.getByRole('button', { name: 'Anthropic', exact: true }).click();
  await card.getByPlaceholder('服务地址 (Base URL)').fill('https://gateway.example/v1');
  await card.getByPlaceholder('服务地址 (Base URL)').press('Enter');
  await card.getByRole('button', { name: '设为当前' }).click();
  await page.locator('.settings-content input[type="password"]').fill('test-placeholder-key');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('已保存 API Key')).toBeVisible();
  const previousCalls = (await searchCalls(page)).length;
  await page.keyboard.press('Meta+1');
  await page.locator('[data-dock-btn="chat"]').click();
  await page.getByPlaceholder(/自然语言描述/).fill('验证地址');
  await page.getByPlaceholder(/自然语言描述/).press('Enter');
  await expect(page.getByText('地址设置已生效', { exact: true }).first()).toBeVisible();
  const calls = (await searchCalls(page)).slice(previousCalls).filter(call => call.cmd === 'llm_stream');
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.map(call => call.args.url)).toEqual(calls.map(() => 'https://gateway.example/v1/messages'));
});

test('font quick settings apply immediately, resize the terminal and persist after reload', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect.poll(async () => (await ptyResizes(page)).length).toBeGreaterThan(0);
  const originalColumns = (await ptyResizes(page)).at(-1)!.cols;
  await gotoSetting(page, '主题');
  const quick = page.getByLabel('字号快速设置');
  await quick.getByRole('button', { name: '15', exact: true }).click();
  await quick.getByRole('button', { name: '增大终端字号' }).click();
  await quick.getByRole('button', { name: '增大终端字号' }).click();
  await expect(quick.getByTestId('terminal-font-size')).toHaveText('16px');
  await expect(page.locator('aside').getByRole('button', { name: '主题', exact: true })).toHaveCSS('font-size', '15px');
  await page.keyboard.press('Meta+1');
  await expect.poll(async () => (await ptyResizes(page)).at(-1)!.cols).toBeLessThan(originalColumns);
  const input = page.getByPlaceholder(/输入命令/);
  await expect(input).toHaveCSS('font-size', '16px');
  await input.fill('echo font-preferences');
  await input.press('Enter');
  const output = page.locator('[data-selectable]').filter({ hasText: 'font-preferences' }).last();
  await expect(output).toHaveCSS('font-size', '16px');
  await page.reload();
  await expect(page.getByPlaceholder(/输入命令/)).toHaveCSS('font-size', '16px');
  await gotoSetting(page, '模型配置');
  await expect(quick.getByRole('button', { name: '15', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await quick.getByRole('button', { name: '恢复默认字号' }).click();
  await expect(quick.getByTestId('terminal-font-size')).toHaveText('14px');
  await page.screenshot({ path: test.info().outputPath('settings.png') });
  await page.locator('aside').getByRole('button', { name: '主题', exact: true }).click();
  await page.getByRole('button', { name: '浅色', exact: true }).click();
  await page.screenshot({ path: test.info().outputPath('settings-light.png') });
});

test('persistent AI toggles keep a visible checkmark and state after hover and reload', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await page.locator('[data-dock-btn="chat"]').click();
  const toggle = page.getByTitle('深度思考（reasoning effort）');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await page.mouse.move(20, 400);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle.locator('.state-icon-check')).toBeVisible();
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle.locator('.state-icon-check')).toBeVisible();
});

test('CMD stored in legacy block mode opens an interactive classic terminal', async ({ page }) => {
  await setupTauriMock(page, { integration: false });
  await page.addInitScript(() => {
    const bridge = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const original = bridge.invoke;
    bridge.invoke = (command, args) => command === 'list_shells'
      ? Promise.resolve([{ id: 'cmd', label: 'CMD', default: true }]) : original(command, args);
    localStorage.setItem('vrykell-agent-settings', JSON.stringify({ version: 8, state: { global: { openModeByShell: { cmd: 'block' } }, overrides: {} } }));
  });
  await page.goto('/');
  await page.getByTestId('tab-new-btn').click();
  await page.getByTestId('new-tab-option-shell:cmd').click();
  const terminal = page.locator('.terminal-pane').last().locator('.xterm');
  await expect(terminal).toBeVisible();
  const input = terminal.locator('.xterm-helper-textarea');
  await input.focus();
  await input.press('a');
  await input.press('Enter');
  expect(await ptyWrites(page)).toContain('a');
  const spawns = await page.evaluate(() => (window as unknown as { __PTY_SPAWNS__: { shell: string; openMode: string }[] }).__PTY_SPAWNS__);
  expect(spawns.some(spawn => spawn.shell === 'cmd' && spawn.openMode === 'classic')).toBe(true);
});
