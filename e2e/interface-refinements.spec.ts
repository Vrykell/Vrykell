import { expect, test } from '@playwright/test';
import { setupTauriMock, clipboardText } from './tauri-mock';
import { openSettings } from './settings';

test.setTimeout(60_000);
test.beforeEach(async ({ page }) => {
  await setupTauriMock(page.context(), { schedulesSeed: [], launchDirectory: '/home/e2e/project' });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
});

test('adds a custom provider, retains the first-entered key and confirms endpoint migration', async ({ page }, info) => {
  await openSettings(page); await page.getByTestId('provider-switch').click(); await page.getByTestId('provider-dialog-add').click(); await page.getByTestId('provider-custom').click();
  const dialog = page.getByTestId('provider-dialog');
  await dialog.getByRole('textbox', { name: '服务商名称' }).fill('Custom endpoint');
  await dialog.getByLabel('API Key', { exact: true }).fill('test-private-key');
  await dialog.getByRole('textbox', { name: 'Base URL', exact: true }).fill('https://custom.example/v1');
  await expect(dialog.getByLabel('API Key', { exact: true })).toHaveValue('test-private-key');
  await dialog.getByRole('textbox', { name: '模型 ID', exact: true }).fill('hy4-preview');
  for (const width of [1240, 760]) { await page.setViewportSize({ width, height: 800 }); await page.screenshot({ path: info.outputPath(`custom-provider-${width}.png`) }); }
  await page.evaluate(async () => { const path = '/src/config/theme/tokens.ts'; const { applyTheme } = await import(path) as typeof import('../src/config/theme/tokens'); applyTheme('light'); });
  await page.screenshot({ path: info.outputPath('custom-provider-light.png') });
  await page.evaluate(async () => { const path = '/src/config/theme/tokens.ts'; const { applyTheme } = await import(path) as typeof import('../src/config/theme/tokens'); applyTheme('dark'); });
  await dialog.getByRole('button', { name: '添加服务商', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('provider-switch')).toContainText('Custom endpoint'); await expect(page.getByTestId('provider-key-value')).toBeVisible();
  expect(await page.evaluate(async () => (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string) => Promise<{ model: string; provider_keys: string[] }> } }).__TAURI_INTERNALS__.invoke('get_ai_config'))).toMatchObject({ model: 'hy4-preview', provider_keys: expect.arrayContaining(['openai-compatible|https://custom.example/v1']) });
  const address = page.getByTestId('provider-endpoint-input'); await address.fill('https://moved.example/v1'); await address.press('Enter');
  await page.getByTestId('confirm-cancel').click(); await expect(address).toHaveValue('https://custom.example/v1');
  await address.fill('https://moved.example/v1'); await address.press('Enter'); await page.getByTestId('confirm-ok').click();
  await expect(address).toHaveValue('https://moved.example/v1'); await expect(page.getByTestId('provider-key-value')).toBeVisible();
  const name = page.getByTestId('model-name').first();
  expect(await name.evaluate(element => getComputedStyle(element).fontWeight)).toBe('400');
});

test('keeps modal command input in one status row, yanks to clipboard and guards quit', async ({ page }, info) => {
  await page.evaluate(async () => {
    const path = '/src/features/workspace/stores/navigation.ts'; const { useWorkspaceNavigation } = await import(path) as typeof import('../src/features/workspace/stores/navigation');
    useWorkspaceNavigation.getState().selectArea('code');
  });
  await page.getByTestId('code-start-page-content').getByRole('button', { name: '新建文件', exact: true }).click();
  const editor = page.getByTestId('file-editor'); await expect(editor.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 });
  const dropdown = page.getByTestId('workspace-instance-bar').locator('.folder-more-button');
  expect(await dropdown.evaluate(element => { const bounds = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)); })).toBe(true);
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: '更多编辑器操作' }).click(); await page.getByRole('menu').locator('button').filter({ hasText: 'Vim 模式' }).click();
  await expect(editor.locator('.code-editor-vim-status')).toContainText('NORMAL');
  await editor.locator('textarea.inputarea').focus(); await page.keyboard.press('i'); await page.keyboard.insertText('clipboard note\nsecond line'); await page.keyboard.press('Escape');
  await page.keyboard.type('ggyy'); await expect.poll(async () => (await clipboardText(page)).replace(/\r\n/g, '\n')).toBe('clipboard note\n');
  await page.keyboard.type(':wq'); const input = editor.getByRole('textbox', { name: 'Vim 命令' }); await expect(input).toHaveValue('wq');
  for (const width of [1240, 760, 560]) {
    await page.setViewportSize({ width, height: 800 }); const status = editor.locator('.code-editor-status');
    const bounds = (await status.boundingBox())!; const command = (await input.boundingBox())!;
    expect(bounds.height).toBe(32); expect(await status.evaluate(element => element.scrollHeight)).toBeLessThanOrEqual(32);
    expect(command.height).toBeGreaterThanOrEqual(24);
    expect(command.y).toBeGreaterThanOrEqual(bounds.y + 1); expect(command.y + command.height).toBeLessThanOrEqual(bounds.y + bounds.height - 1);
    expect(Math.abs(command.y + command.height / 2 - bounds.y - bounds.height / 2)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath(`vim-command-${width}.png`) });
  }
  await page.keyboard.press('Escape'); await editor.locator('textarea.inputarea').focus();
  await page.keyboard.type(':q'); await page.keyboard.press('Enter');
  const guard = page.getByRole('dialog', { name: '未保存的更改' }); await expect(guard).toBeVisible(); await guard.getByRole('button', { name: '取消', exact: true }).click();
  await editor.locator('textarea.inputarea').focus(); await page.keyboard.type(':q!'); await page.keyboard.press('Enter'); await expect(page.getByTestId('code-start-page')).toBeVisible();
});

test('restores sidebar history, fits rename inputs and colors complete fenced blocks', async ({ page }, info) => {
  await page.evaluate(async () => {
    const dockPath = '/src/features/workspace/stores/dock.ts'; const { useDockStore } = await import(dockPath) as typeof import('../src/features/workspace/stores/dock');
    useDockStore.getState().openPanel('chat');
    const path = '/src/features/chat/stores/chat.ts'; const { useChatStore } = await import(path) as typeof import('../src/features/chat/stores/chat');
    const store = useChatStore.getState(); const first = store.createConversation(); store.renameConversation(first, 'Short');
    const second = store.createConversation(); store.renameConversation(second, 'Recent response');
    const workspacePath = '/src/features/chat/stores/aiWorkspace.ts';
    const { useAiWorkspace } = await import(workspacePath) as typeof import('../src/features/chat/stores/aiWorkspace');
    useAiWorkspace.getState().ensureNative(first);
    useAiWorkspace.getState().selectSide(`chat:${second}`);
    useChatStore.setState(state => ({ byTab: { ...state.byTab, [second]: [
      { id: 'question', role: 'user', content: 'Code sample', createdAt: 1 },
      { id: 'reply', role: 'assistant', content: '```ts\nconst value = "safe";\n// second line\n```', createdAt: 2 },
    ] } }));
  });
  const panel = page.getByTestId('ai-sidebar-content');
  await expect(panel.locator('[data-code-token="keyword.ts"]')).toHaveCount(1);
  await expect(panel.locator('[data-code-token^="comment"]')).toHaveText('// second line');
  await panel.getByRole('button', { name: '会话设置', exact: true }).click(); await page.getByRole('combobox', { name: '侧栏对话' }).click(); await page.getByRole('option', { name: 'Short', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(panel.getByRole('button', { name: '重命名对话' })).toHaveText('Short');
  await panel.getByRole('button', { name: '重命名对话' }).click(); const input = panel.getByRole('textbox', { name: '对话标题' });
  const small = (await input.boundingBox())!.width; expect(small).toBeLessThanOrEqual(176);
  await input.fill('A much longer conversation name'); const medium = (await input.boundingBox())!.width; expect(medium).toBe(small);
  await input.fill('A long title '.repeat(40)); expect((await input.boundingBox())!.width).toBe(small);
  await page.setViewportSize({ width: 760, height: 800 }); await page.screenshot({ path: info.outputPath('sidebar-rename-760.png') });
  await input.press('Escape');
  await page.evaluate(async () => {
    const path = '/src/features/workspace/stores/workspace.ts'; const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    const chatPath = '/src/features/chat/stores/chat.ts'; const { useChatStore } = await import(chatPath) as typeof import('../src/features/chat/stores/chat');
    useChatStore.getState().renameConversation(useChatStore.getState().activeConversationId, 'A very long conversation title to verify the menu layer');
    useWorkspaceStore.getState().openHarnessTab();
  });
  const dropdown = page.getByTestId('workspace-instance-bar').locator('.folder-more-button');
  await expect(dropdown).toBeVisible();
  await page.getByTestId('workspace-instance-bar').locator('.folder-tab-list').evaluate(element => { element.scrollLeft = 100; });
  expect(await dropdown.evaluate(element => { const bounds = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)); })).toBe(true);
  await dropdown.click(); await expect(page.getByRole('menu')).toBeVisible();
});

test('retains command-cycle ownership across argument completion', async ({ page }) => {
  const input = page.locator('textarea[data-terminal-input="true"]:visible'); await expect(input).toBeVisible();
  await page.evaluate(async () => {
    const path = '/src/features/terminal/stores/history.ts'; const { useHistoryStore } = await import(path) as typeof import('../src/features/terminal/stores/history');
    useHistoryStore.setState({ entries: [{ command: 'git status', cwd: '', timestamp: 2, exitCode: 0 }, { command: 'git log', cwd: '', timestamp: 1, exitCode: 0 }] });
    const settings = '/src/features/agent/stores/agentSettings.ts'; const { useAgentSettings } = await import(settings) as typeof import('../src/features/agent/stores/agentSettings');
    useAgentSettings.setState(state => ({ global: { ...state.global, completeEnabled: true } }));
  });
  await input.fill('git'); await input.press('Tab'); await expect(input).toHaveValue('git status'); await input.press('Tab'); await expect(input).toHaveValue('git log');
  await input.press('Shift+Tab'); await expect(input).toHaveValue('git status'); await input.press('Escape'); await expect(input).toHaveValue('git');
  await input.fill('cat not'); await input.press('Tab'); await expect(input).toHaveValue('cat notes.txt');
});
