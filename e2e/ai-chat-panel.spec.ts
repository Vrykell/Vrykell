/**
 * AI 聊天面板 e2e：面板对话 / 模型菜单 / 思考强度 / 深思与 Agent 开关 / 输入锁定。
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock, mockAnthropic, aiModelCalls, ensureChatSettingsOpen, paceLlmStream, mockAnthropicToolCall, clipboardText } from './tauri-mock';

type MockOptions = Parameters<typeof setupTauriMock>[1];

/** 每个测试独立初始化：mockAnthropic 的 init script 必须在 goto 前注册 */
async function boot(page: import('@playwright/test').Page, reply: string, options?: MockOptions) {
  await mockAnthropic(page, reply);
  await setupTauriMock(page, options);
  // 种入 dock 布局：chat 面板按钮在左区（默认布局里 chat 不在任何 zone）
  await page.addInitScript(() => {
    localStorage.setItem('dock-layout-v4', JSON.stringify({
      leftZone: ['tabs', 'chat'], rightZone: ['files'],
      leftPanels: [], rightPanels: [], panelWidths: {},
    }));
  });
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
}

test.describe('AI 对话面板', () => {
  test('opening the panel does not move focus into the chat composer', async ({ page }) => {
    await boot(page, 'OK');
    const trigger = page.locator('[data-dock-btn="chat"]');
    await trigger.click();
    const composer = page.locator('[data-chat-composer]');
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

  test('打开面板发送消息，流式渲染回复', async ({ page }) => {
    await boot(page, '面板回复内容');
    await page.locator('[data-dock-btn="chat"]').click();
    const input = page.getByPlaceholder(/自然语言描述/);
    await expect(input).toBeVisible({ timeout: 3000 });
    await input.fill('帮我看看');
    await input.press('Enter');
    await expect(page.getByText('面板回复内容')).toBeVisible({ timeout: 10000 });
  });

  test('停止生成：中断后收尾回到发送按钮（读取器不再永久挂起）', async ({ page }) => {
    // Deliver the answer piece by piece so it is still arriving when Stop is pressed, and keep the
    // single send slot free: the default schedule seed would fire a background turn at boot.
    await paceLlmStream(page, 30);
    await boot(page, '这是一段足够长的流式回复内容。'.repeat(12), { schedulesSeed: [] });
    await page.locator('[data-dock-btn="chat"]').click();
    const input = page.getByPlaceholder(/自然语言描述/);
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

    // 中断必须真正收尾：对话框回到可发送状态，而不是一直停在「生成中」。
    await expect(sendButton).toHaveAttribute('aria-label', '发送', { timeout: 5000 });
    await expect(input).toBeEnabled();
  });

  test('复制被终止的回复：还没有正文时复制工具日志，而不是空串', async ({ page }) => {
    await mockAnthropic(page, '收尾文字');
    await mockAnthropicToolCall(page, 'run_command', { command: 'npm run build' });
    await setupTauriMock(page, { schedulesSeed: [] });
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
    await page.locator('[data-dock-btn="chat"]').click();
    const input = page.getByPlaceholder(/自然语言描述/);
    await expect(input).toBeVisible({ timeout: 3000 });
    // run_command needs the conversation's terminal, and it waits on the approval card.
    await ensureChatSettingsOpen(page);
    await page.getByRole('combobox', { name: '选择执行终端' }).click();
    await page.getByRole('option').filter({ hasNotText: '仅讨论' }).first().click();
    await input.fill('跑构建');
    await input.press('Enter');
    await expect(page.getByRole('button', { name: '允许一次' })).toBeVisible({ timeout: 10000 });

    // Stop while the reply holds no answer text: only the tool has been produced.
    await page.locator('.chat-send-button').click();
    await expect(page.getByRole('button', { name: '发送' })).toBeVisible({ timeout: 5000 });
    await page.getByTestId('chat-answer-copy').click();
    expect(await clipboardText(page)).toContain('[执行命令: npm run build');
  });

  test('复制被终止的回复：停止后复制按钮给出已经收到的正文', async ({ page }) => {
    // 流式放慢，保证点「停止」时正文只到了一部分。
    await paceLlmStream(page, 60);
    await boot(page, '这是一段足够长的流式回复内容。'.repeat(40), { schedulesSeed: [] });
    await page.locator('[data-dock-btn="chat"]').click();
    const input = page.getByPlaceholder(/自然语言描述/);
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
    // 等第一部分正文到达再中断，此时回答里已经有可复制的内容。
    await expect(page.locator('.ai-block-answer')).toContainText('流式回复内容', { timeout: 5000 });
    await sendButton.click();
    await expect(sendButton).toHaveAttribute('aria-label', '发送', { timeout: 5000 });

    await page.getByTestId('chat-answer-copy').click();
    expect(await clipboardText(page)).toContain('流式回复内容');
  });

  test('opening the AI assistant leaves command input available', async ({ page }) => {
    await boot(page, '好的');
    await page.locator('[data-dock-btn="chat"]').click();
    await expect(page.locator('[data-chat-composer]')).toBeVisible();
    await expect(page.locator('[data-terminal-input]')).toBeVisible();
    await expect(page.getByRole('button', { name: '询问 AI', exact: true })).toBeEnabled();
    await page.locator('[data-terminal-input]').fill('echo command');
    await expect(page.locator('[data-chat-composer]')).toHaveValue('');
  });

  test('模型选择窗口：搜索过滤 + 能力标签过滤 + 点击选中', async ({ page }) => {
    await boot(page, '好的');
    await page.locator('[data-dock-btn="chat"]').click();
    await expect(page.getByPlaceholder(/自然语言描述/)).toBeVisible();
    // 打开模型选择窗口
    await ensureChatSettingsOpen(page);
    await page.locator('[data-tip="切换模型"]').click();
    await expect(page.getByText('选择模型', { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder('搜索模型…')).toBeVisible();
    // 两个模型列表项（带能力徽标）
    await expect(page.getByTestId('model-pick-m-main')).toBeVisible();
    await expect(page.getByTestId('model-pick-m-local')).toBeVisible();
    await expect(page.getByText('推理', { exact: true }).first()).toBeVisible();

    // 能力标签过滤：点「推理」→ 只剩主力模型
    await page.getByRole('button', { name: /推理/ }).click();
    await expect(page.getByTestId('model-pick-m-main')).toBeVisible();
    await expect(page.getByTestId('model-pick-m-local')).toHaveCount(0);
    await page.getByRole('button', { name: /推理/ }).click(); // 取消

    // 搜索过滤：按名字
    await page.getByPlaceholder('搜索模型…').fill('本地');
    await expect(page.getByTestId('model-pick-m-local')).toBeVisible();
    await expect(page.getByTestId('model-pick-m-main')).toHaveCount(0);
    await page.getByPlaceholder('搜索模型…').fill('不存在的模型');
    await expect(page.getByText('无匹配模型')).toBeVisible();

    // 点击列表项选中模型
    await page.getByPlaceholder('搜索模型…').fill('');
    await page.getByTestId('model-pick-m-main').click();
    const calls = await aiModelCalls(page);
    expect(calls.some((c) => c.kind === 'set_active' && c.id === 'm-main')).toBe(true);
    await expect(page.getByText('已切换到 主力模型')).toBeVisible();
    // 选中后窗口关闭
    await expect(page.getByText('选择模型', { exact: true })).toHaveCount(0);
  });

  test('模型选择窗口：思考强度只在模型配置页调整', async ({ page }) => {
    await boot(page, '好的');
    await page.locator('[data-dock-btn="chat"]').click();
    await expect(page.getByPlaceholder(/自然语言描述/)).toBeVisible();
    await ensureChatSettingsOpen(page);
    await page.locator('[data-tip="切换模型"]').click();
    const row = page.getByTestId('model-pick-m-main');
    await expect(row).toBeVisible();
    const select = row.getByTestId('think-level-m-main');
    await expect(select).toHaveCount(0);
    await expect(page.getByTestId('model-pick-m-local').locator('select')).toHaveCount(0);
    // 关闭窗口
    await page.keyboard.press('Escape');
    await expect(page.getByText('选择模型', { exact: true })).toHaveCount(0);
  });

  test('the unified chat and approval menu persists model and permission choices', async ({ page }) => {
    await boot(page, '好的');
    await page.locator('[data-dock-btn="chat"]').click();
    await expect(page.getByPlaceholder(/自然语言描述/)).toBeVisible();
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
    await page.locator('[data-dock-btn="chat"]').click();
    await ensureChatSettingsOpen(page);
    await expect(mode).toHaveAttribute('data-mode', 'strict');
    await expect(page.locator('[data-tip="深度思考（reasoning effort）"]')).toHaveCount(0);
  });
});
