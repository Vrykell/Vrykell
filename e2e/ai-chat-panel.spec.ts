/**
 * AI chat panel e2e: panel conversation, model menu, thinking effort, deep-thinking and Agent toggles, input locking.
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock, mockAnthropic, aiModelCalls, ensureChatSettingsOpen, paceLlmStream, mockAnthropicToolCall, clipboardText } from './tauri-mock';

type MockOptions = Parameters<typeof setupTauriMock>[1];

/** Sets up each test independently: the mockAnthropic init script must be registered before goto */
async function boot(page: import('@playwright/test').Page, reply: string, options?: MockOptions) {
  await mockAnthropic(page, reply);
  await setupTauriMock(page, options);
  // Seed the dock layout: the chat panel button sits in the left zone (the default layout keeps chat out of every zone)
  await page.addInitScript(() => {
    if (!localStorage.getItem('dock-layout-v6')) localStorage.setItem('dock-layout-v6', JSON.stringify({
      layoutVersion: 6, leftZone: [], rightZone: ['files', 'git', 'command-history', 'chat'],
      leftPanels: [], rightPanels: [], panelWidths: {},
    }));
  });
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
}

test.describe('AI chat panel', () => {
  test('opening the panel does not move focus into the chat composer', async ({ page }) => {
    await boot(page, 'OK');
    const trigger = page.locator('[data-dock-btn="chat"]');
    await trigger.click();
    const composer = page.locator('[data-chat-composer]:visible');
    await expect(composer).toBeVisible();
    await expect(composer).not.toBeFocused();
  });

  test('conversation settings start with discussion and the composer keeps attachment controls', async ({ page }) => {
    await boot(page, 'OK');
    await page.locator('[data-dock-btn="chat"]').click();
    await ensureChatSettingsOpen(page);
    await expect(page.getByRole('combobox', { name: '选择执行终端' })).toBeVisible();
    const status = page.locator('.chat-input-status');
    await expect(status.getByTestId('chat-approval-select')).toBeVisible();
    await expect(page.getByRole('region', { name: '会话设置' }).getByTestId('chat-approval-select')).toHaveCount(0);
    await expect(status.getByRole('button', { name: '添加附件' })).toBeVisible();
  });

  test('opening the panel sends a message and streams the reply', async ({ page }) => {
    await boot(page, '面板回复内容');
    await page.locator('[data-dock-btn="chat"]').click();
    const input = page.locator('[data-chat-composer]:visible');
    await expect(input).toBeVisible({ timeout: 3000 });
    await input.fill('帮我看看');
    await input.press('Enter');
    await expect(page.getByText('面板回复内容')).toBeVisible({ timeout: 10000 });
  });

  test('stop generation: an interrupted reply settles back to the send button (the reader no longer hangs forever)', async ({ page }) => {
    // Deliver the answer piece by piece so it is still arriving when Stop is pressed, and keep the
    // single send slot free: the default schedule seed would fire a background turn at boot.
    await paceLlmStream(page, 30);
    await boot(page, '这是一段足够长的流式回复内容。'.repeat(12), {});
    await page.locator('[data-dock-btn="chat"]').click();
    const input = page.locator('[data-chat-composer]:visible');
    await expect(input).toBeVisible({ timeout: 3000 });
    // The panel needs an active conversation before sending: without one the request falls back to
    // the workspace tab and the stop button has nothing to match.
    await page.waitForFunction(async () => {
      const mod = await import('/src/features/chat/stores/chat.ts') as typeof import('../src/features/chat/stores/chat');
      const state = mod.useChatStore.getState();
      return !!state.activeConversationId && state.activeConversationId in state.byTab;
    });
    await input.fill('写一段长回答');
    await input.press('Enter');

    const sendButton = page.locator('.chat-send-button');
    await expect(sendButton).toHaveAttribute('aria-label', '停止生成', { timeout: 5000 });
    await sendButton.click();

    // The interruption must really settle: the composer returns to a sendable state instead of staying in "generating".
    await expect(sendButton).toHaveAttribute('aria-label', '发送', { timeout: 5000 });
    await expect(input).toBeEnabled();
  });

  test('copying a stopped reply: with no body yet, copy returns the tool log instead of an empty string', async ({ page }) => {
    await mockAnthropic(page, '收尾文字');
    await mockAnthropicToolCall(page, 'run_command', { command: 'npm run build' });
    await setupTauriMock(page, {});
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
    await page.locator('[data-dock-btn="chat"]').click();
    const input = page.locator('[data-chat-composer]:visible');
    await expect(input).toBeVisible({ timeout: 3000 });
    // run_command needs the conversation's terminal, and it waits on the approval card.
    await ensureChatSettingsOpen(page);
    await page.getByRole('combobox', { name: '选择执行终端' }).click();
    await page.getByRole('option').filter({ hasNotText: '仅讨论' }).first().click();
    await input.fill('跑构建');
    await input.press('Enter');
    await expect(page.getByRole('button', { name: '运行', exact: true })).toBeVisible({ timeout: 10000 });

    // Stop while the reply holds no answer text: only the tool has been produced.
    await page.locator('.chat-send-button').click();
    await expect(page.getByRole('button', { name: '发送' })).toBeVisible({ timeout: 5000 });
    await page.getByTestId('chat-answer-copy').click();
    expect(await clipboardText(page)).toContain('[执行命令: npm run build');
  });

  test('copying a stopped reply: after stopping, copy returns the body received so far', async ({ page }) => {
    // Slow the stream so only part of the body has arrived when Stop is pressed.
    await paceLlmStream(page, 60);
    await boot(page, '这是一段足够长的流式回复内容。'.repeat(40), {});
    await page.locator('[data-dock-btn="chat"]').click();
    const input = page.locator('[data-chat-composer]:visible');
    await expect(input).toBeVisible({ timeout: 3000 });
    await page.waitForFunction(async () => {
      const mod = await import('/src/features/chat/stores/chat.ts') as typeof import('../src/features/chat/stores/chat');
      const state = mod.useChatStore.getState();
      return !!state.activeConversationId && state.activeConversationId in state.byTab;
    });
    await input.fill('写一段长回答');
    await input.press('Enter');

    const sendButton = page.locator('.chat-send-button');
    await expect(sendButton).toHaveAttribute('aria-label', '停止生成', { timeout: 5000 });
    // Wait for the first part of the body before interrupting so the answer already holds copyable content.
    await expect(page.locator('.ai-block-answer')).toContainText('流式回复内容', { timeout: 5000 });
    await sendButton.click();
    await expect(sendButton).toHaveAttribute('aria-label', '发送', { timeout: 5000 });

    await page.getByTestId('chat-answer-copy').click();
    expect(await clipboardText(page)).toContain('流式回复内容');
  });

  test('opening the AI assistant leaves command input available', async ({ page }) => {
    await boot(page, '好的');
    await page.locator('[data-dock-btn="chat"]').click();
    await expect(page.locator('[data-chat-composer]:visible')).toBeVisible();
    await expect(page.locator('[data-terminal-input]')).toBeVisible();
    await expect(page.getByRole('button', { name: '询问 AI', exact: true })).toBeEnabled();
    await page.locator('[data-terminal-input]').fill('echo command');
    await expect(page.locator('[data-chat-composer]:visible')).toHaveValue('');
  });

  test('model picker: search filtering, capability badge filtering and click to select', async ({ page }) => {
    await boot(page, '好的');
    await page.locator('[data-dock-btn="chat"]').click();
    await expect(page.locator('[data-chat-composer]:visible')).toBeVisible();
    // Open the model picker
    await ensureChatSettingsOpen(page);
    await page.locator('[data-tip="切换模型"]').click();
    await expect(page.getByText('选择模型', { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder('搜索模型…')).toBeVisible();
    // Both model rows are listed with their capability badges
    await expect(page.getByTestId('model-pick-m-main')).toBeVisible();
    await expect(page.getByTestId('model-pick-m-local')).toBeVisible();
    await expect(page.getByText('推理', { exact: true }).first()).toBeVisible();
    const localRow = page.getByTestId('model-pick-m-local');
    await expect(localRow.locator('.model-cap-chip')).toHaveCount(1);
    await expect(localRow.getByTestId('model-cap-tools')).toHaveAttribute('data-supported', 'true');
    await expect(localRow.getByTestId('model-cap-vision')).toHaveCount(0);

    // Capability filter: clicking "Reasoning" leaves only the main model
    await page.getByRole('button', { name: /推理/ }).click();
    await expect(page.getByTestId('model-pick-m-main')).toBeVisible();
    await expect(page.getByTestId('model-pick-m-local')).toHaveCount(0);
    await page.getByRole('button', { name: /推理/ }).click(); // clear the filter

    // Search filtering by name
    await page.getByPlaceholder('搜索模型…').fill('本地');
    await expect(page.getByTestId('model-pick-m-local')).toBeVisible();
    await expect(page.getByTestId('model-pick-m-main')).toHaveCount(0);
    await page.getByPlaceholder('搜索模型…').fill('不存在的模型');
    await expect(page.getByText('无匹配模型')).toBeVisible();

    // Clicking a row selects the model
    await page.getByPlaceholder('搜索模型…').fill('');
    await page.getByTestId('model-pick-m-main').click();
    const calls = await aiModelCalls(page);
    expect(calls.some((c) => c.kind === 'set_active' && c.id === 'm-main')).toBe(true);
    await expect(page.getByText('已切换到 主力模型')).toBeVisible();
    // The picker closes after a selection
    await expect(page.getByText('选择模型', { exact: true })).toHaveCount(0);
  });

  test('model picker: thinking effort is only adjusted on the model settings page', async ({ page }) => {
    await boot(page, '好的');
    await page.locator('[data-dock-btn="chat"]').click();
    await expect(page.locator('[data-chat-composer]:visible')).toBeVisible();
    await ensureChatSettingsOpen(page);
    await page.locator('[data-tip="切换模型"]').click();
    const row = page.getByTestId('model-pick-m-main');
    await expect(row).toBeVisible();
    const select = row.getByTestId('think-level-m-main');
    await expect(select).toHaveCount(0);
    await expect(page.getByTestId('model-pick-m-local').locator('select')).toHaveCount(0);
    // Close the picker
    await page.keyboard.press('Escape');
    await expect(page.getByText('选择模型', { exact: true })).toHaveCount(0);
  });

  test('the unified chat and approval menu persists model and permission choices', async ({ page }) => {
    await boot(page, '好的');
    await page.locator('[data-dock-btn="chat"]').click();
    await expect(page.locator('[data-chat-composer]:visible')).toBeVisible();
    const mode = page.getByRole('button', { name: '对话与审批模式' });
    await ensureChatSettingsOpen(page);
    await mode.click();
    await page.getByRole('option', { name: /^纯聊天/ }).click();
    let saved = await page.evaluate(() => localStorage.getItem('vrykell-agent-settings') ?? '');
    expect(saved).toContain('"agentMode":false');
    await mode.click();
    await page.getByRole('option', { name: /^标准权限/ }).click();
    saved = await page.evaluate(() => localStorage.getItem('vrykell-agent-settings') ?? '');
    expect(saved).toContain('"agentMode":true');
    await mode.click();
    await page.getByRole('option', { name: /^严格权限/ }).click();
    await expect(mode).toHaveAttribute('data-mode', 'strict');
    await page.reload();
    await expect(page.locator('[data-chat-composer]:visible')).toBeVisible();
    await ensureChatSettingsOpen(page);
    await expect(mode).toHaveAttribute('data-mode', 'strict');
    await expect(page.locator('[data-tip="深度思考（reasoning effort）"]')).toHaveCount(0);
  });
});
