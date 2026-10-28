import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

for (const theme of ['dark', 'light']) for (const width of [900, 1440]) {
  test(`agent dropdown and tool feedback in ${theme} at ${width}`, async ({ page }, info) => {
    await setupTauriMock(page);
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    await gotoSetting(page, '主题');
    await page.getByRole('radio', { name: theme === 'dark' ? '始终深色' : '始终浅色', exact: true }).click();
    await page.locator('[data-dock-btn="chat"]').click();
    const side = page.getByTestId('ai-sidebar-content');
    await expect(side.locator('[data-chat-composer]')).toBeVisible();
    await side.getByRole('button', { name: '会话设置', exact: true }).click();
    const agent = page.getByRole('button', { name: '选择智能体', exact: true });
    const recent = page.getByRole('combobox', { name: '侧栏对话' });
    await expect(agent).toHaveClass('ui-select');
    expect((await agent.boundingBox())!.width).toBeCloseTo((await recent.boundingBox())!.width, 0);
    await agent.click();
    await expect(agent).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('acp-launcher-directory')).toBeVisible();
    await expect(page.getByTestId('acp-launcher-Fake ACP')).toBeVisible();
    await page.screenshot({ path: info.outputPath('agent-dropdown.png') });
    await page.keyboard.press('Escape');
    await expect(agent).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Escape');
    await page.evaluate(async () => {
      const path = '/src/features/chat/stores/chat.ts';
      const { useChatStore } = await import(path) as typeof import('../src/features/chat/stores/chat');
      const workspacePath = '/src/features/chat/stores/aiWorkspace.ts';
      const { useAiWorkspace } = await import(workspacePath) as typeof import('../src/features/chat/stores/aiWorkspace');
      const id = useAiWorkspace.getState().sideSelected.slice(5);
      useChatStore.setState({ byTab: { [id]: [
        { id: 'question', role: 'user', content: 'Check tool results', createdAt: 1 },
        { id: 'answer', role: 'assistant', content: '', createdAt: 2, parts: [
          { kind: 'tool', tool: { toolCallId: 'failure', toolName: 'read_file', state: 'error', input: { path: '/missing' }, error: 'Missing file', startedAt: 1 } },
          { kind: 'tool', tool: { toolCallId: 'refusal', toolName: 'run_command', state: 'denied', input: { command: 'blocked' }, danger: 'Confirmation skipped', startedAt: 1 } },
          { kind: 'tool', tool: { toolCallId: 'question', toolName: 'ask_user', state: 'cancelled', input: { question: 'Continue?' }, error: 'Question cancelled', startedAt: 1 } },
          { kind: 'tool', tool: { toolCallId: 'live', toolName: 'read_file', state: 'running', input: { path: '/live' }, startedAt: 1 } },
        ] },
      ] } });
    });
    const failure = side.locator('[data-tool-state="error"] .ai-tool-state');
    const refusal = side.locator('[data-tool-state="denied"] .ai-tool-state');
    await expect(failure).toBeVisible();
    await expect(refusal).toHaveCSS('color', await failure.evaluate(element => getComputedStyle(element).color));
    await expect(refusal).toHaveCSS('background-color', await failure.evaluate(element => getComputedStyle(element).backgroundColor));
    const cancelled = side.locator('[data-tool-state="cancelled"] .ai-tool-state');
    await expect(cancelled).toHaveText('已取消');
    const approval = await page.evaluate(() => {
      const card = document.createElement('div'); card.className = 'ai-tool-card'; card.dataset.toolState = 'approval-pending';
      const badge = document.createElement('span'); badge.className = 'ai-tool-state'; card.append(badge); document.body.append(card);
      const style = getComputedStyle(badge); const colors = { color: style.color, background: style.backgroundColor }; card.remove(); return colors;
    });
    await expect(cancelled).toHaveCSS('color', approval.color);
    await expect(cancelled).toHaveCSS('background-color', approval.background);
    await expect(side.locator('.ai-tool-verdict')).toHaveCount(0);
    await expect(page.locator('#app-notifications [role="alert"]')).toHaveCount(0);
    await refusal.click();
    const notice = page.locator('#app-notifications [role="alert"]');
    await expect(notice).toContainText('Confirmation skipped');
    const bounds = (await notice.boundingBox())!;
    expect(bounds.x + bounds.width).toBeGreaterThan(width - 40);
    expect(bounds.y + bounds.height).toBeGreaterThan(740);
    await notice.getByRole('button', { name: '关闭错误提示' }).click();
    await page.evaluate(async () => {
      const path = '/src/features/chat/stores/chat.ts';
      const { useChatStore } = await import(path) as typeof import('../src/features/chat/stores/chat');
      const workspacePath = '/src/features/chat/stores/aiWorkspace.ts';
      const { useAiWorkspace } = await import(workspacePath) as typeof import('../src/features/chat/stores/aiWorkspace');
      const id = useAiWorkspace.getState().sideSelected.slice(5);
      useChatStore.setState(state => ({ byTab: { ...state.byTab, [id]: state.byTab[id]!.map(message => ({ ...message,
        parts: message.parts?.map(part => part.kind === 'tool' && part.tool.toolCallId === 'live'
          ? { kind: 'tool', tool: { ...part.tool, state: 'error', error: 'Live read failed' } } : part),
      })) } }));
    });
    await expect(notice).toContainText('Live read failed');
    await expect(side.locator('[role="alert"]')).toHaveCount(0);
    await notice.evaluate(async element => { await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished)); });
    await page.screenshot({ path: info.outputPath('tool-feedback.png') });
  });
}
