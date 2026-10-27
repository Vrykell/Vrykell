import { test, expect } from '@playwright/test';
import { setupTauriMock, mockAnthropic, searchCalls, ptyWrites, ptyResizes, ensureChatSettingsOpen } from './tauri-mock';
import { gotoSetting } from './settings';

test('saved custom Anthropic address is used by the next chat request', async ({ page }) => {
  await setupTauriMock(page);
  await mockAnthropic(page, '地址设置已生效');
  await page.goto('/');
  await gotoSetting(page, '模型配置');
  // The provider switcher starts on Anthropic; its address applies to every model under it.
  await page.getByTestId('provider-endpoint-input').fill('https://gateway.example/v1');
  await page.getByTestId('provider-endpoint-input').press('Enter');
  await page.getByTestId('provider-key-add').click();
  await page.getByTestId('key-dialog-input').fill('test-placeholder-key');
  await page.getByTestId('key-dialog-save').click();
  await expect(page.getByTestId('provider-key-value')).toBeVisible();
  // The provider's ⋯ menu makes one of its models the current one.
  await page.locator('.settings-content').getByLabel('更多操作').click();
  await page.getByRole('menu').getByText('设为当前').click();
  const previousCalls = (await searchCalls(page)).length;
  await page.keyboard.press('Meta+1');
  await page.locator('[data-dock-btn="chat"]').click();
  await page.locator('[data-chat-composer]:visible').fill('验证地址');
  await page.locator('[data-chat-composer]:visible').press('Enter');
  await expect(page.getByText('地址设置已生效', { exact: true }).first()).toBeVisible();
  const calls = (await searchCalls(page)).slice(previousCalls).filter(call => call.cmd === 'llm_stream');
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.map(call => call.args.url)).toEqual(calls.map(() => 'https://gateway.example/v1/messages'));
});

test('typography settings apply globally and are absent from other settings pages', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect.poll(async () => (await ptyResizes(page)).length).toBeGreaterThan(0);
  const originalColumns = (await ptyResizes(page)).at(-1)!.cols;
  await gotoSetting(page, '字体与显示');
  const fonts = page.getByLabel('字号设置');
  await fonts.getByRole('combobox', { name: '页面字号' }).click();
  await page.getByRole('option', { name: '15px', exact: true }).click();
  await fonts.getByRole('combobox', { name: '终端字号' }).click();
  await page.getByRole('option', { name: '16px', exact: true }).click();
  // Renderer preferences persist alongside typography without replacing open sessions.
  await fonts.getByRole('combobox', { name: '终端渲染器' }).click();
  await page.getByRole('option', { name: 'DOM（边缘更干净）', exact: true }).click();
  await expect(fonts.getByRole('combobox', { name: '终端渲染器' })).toHaveText('DOM（边缘更干净）');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('vrykell-typography')!).state.terminalRenderer)).toBe('dom');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('aside').getByRole('button', { name: '字体与显示', exact: true })).toHaveCSS('font-size', '15px');
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
  await expect(fonts).toHaveCount(0);
  await page.locator('aside').getByRole('button', { name: '模型行为', exact: true }).click();
  await expect(fonts).toHaveCount(0);
  await page.locator('aside').getByRole('button', { name: '字体与显示', exact: true }).click();
  await expect(fonts.getByRole('combobox', { name: '页面字号' })).toHaveText('15px');
  await expect(fonts.getByRole('combobox', { name: '终端字号' })).toHaveText('16px');
  await fonts.getByRole('button', { name: '恢复默认字体设置' }).click();
  await expect(fonts.getByRole('combobox', { name: '终端字号' })).toHaveText('14px');
  await expect(fonts.getByRole('combobox', { name: '终端渲染器' })).toHaveText('WebGL（默认）');
  await page.screenshot({ path: test.info().outputPath('settings.png') });
  await page.locator('aside').getByRole('button', { name: '主题', exact: true }).click();
  await page.getByRole('radio', { name: '浅色', exact: true }).click();
  await page.screenshot({ path: test.info().outputPath('settings-light.png') });
});

test('chat mode dropdown persists per model and replaces the two header toggles', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await page.locator('[data-dock-btn="chat"]').click();
  const mode = page.getByRole('button', { name: '对话与审批模式' });
  await ensureChatSettingsOpen(page);
  await page.mouse.move(0, 0);
  await expect(mode).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('[data-tip="深度思考（reasoning effort）"]')).toHaveCount(0);
  await expect(page.getByTestId('pill-level')).toHaveCount(0);
  const modeBounds = await mode.boundingBox();
  const modelBounds = await page.getByTestId('pill-name').boundingBox();
  expect(modeBounds!.x + modeBounds!.width).toBeLessThan(modelBounds!.x);
  await mode.press('ArrowDown');
  const menu = page.getByRole('listbox', { name: '对话与审批模式' });
  // The menu uses the shared floating-surface radius.
  await expect(menu).toHaveCSS('border-radius', '10px');
  await expect(menu.getByRole('option').first()).toHaveCSS('border-top-width', '0px');
  await expect(menu.getByText('只进行对话，不调用工具。')).toBeVisible();
  await expect(menu.getByText('按工具设置判定。')).toBeVisible();
  await expect(menu.getByRole('option')).toHaveCount(4);
  const agent = menu.getByRole('option', { name: /^标准权限/ });
  await expect(agent).toBeFocused();
  await expect(agent).toHaveAttribute('aria-selected', 'true');
  await agent.press('Home');
  await menu.getByRole('option', { name: /^纯聊天/ }).press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(mode).toBeFocused();
  await page.mouse.move(0, 0);
  await expect(mode).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await mode.click();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: test.info().outputPath('chat-mode-open.png') });
  await page.getByRole('option', { name: /^纯聊天/ }).press('Escape');
  await expect(mode).toHaveAttribute('data-mode', 'chat');
  await page.reload();
  await ensureChatSettingsOpen(page);
  await expect(mode).toHaveAttribute('data-mode', 'chat');
  await page.getByTestId('pill-name').click();
  await page.getByTestId('model-pick-m-main').click();
  await expect(mode).toHaveAttribute('data-mode', 'standard');
  await page.getByTestId('pill-name').click();
  await page.getByTestId('model-pick-m-local').click();
  await expect(mode).toHaveAttribute('data-mode', 'chat');
  await page.screenshot({ path: test.info().outputPath('chat-mode.png') });
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
