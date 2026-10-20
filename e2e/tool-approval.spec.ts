import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test('compact AI cards keep their color on disclosure, react to hover and review edited commands', async ({ page }, info) => {
  await setupTauriMock(page); await page.goto('/');
  await page.locator('[data-dock-btn="chat"]').click();
  await expect(page.locator('[data-chat-composer]')).toBeVisible();
  await page.evaluate(async () => {
    const chatPath = '/src/features/chat/stores/chat.ts';
    const permissionsPath = '/src/features/agent/stores/permissions.ts';
    const { useChatStore } = await import(chatPath) as typeof import('../src/features/chat/stores/chat');
    const { gate, usePermissions } = await import(permissionsPath) as typeof import('../src/features/agent/stores/permissions');
    const id = useChatStore.getState().activeConversationId;
    useChatStore.setState({ byTab: { [id]: [
      { id: 'question', role: 'user', content: 'Check the project', createdAt: 1 },
      { id: 'answer', role: 'assistant', content: '', reasoning: 'Inspect the workspace before running checks.', createdAt: 2,
        environment: { paneId: 't1#0', label: 'Project terminal', kind: 'local', cwd: '/repo' }, parts: [
          { kind: 'tool', tool: { toolCallId: 'read', toolName: 'read_file', state: 'done', input: { path: '/repo/main.ts' }, output: 'Ready', startedAt: 1 } },
          { kind: 'tool', tool: { toolCallId: 'review', toolName: 'run_command', state: 'approval-pending', input: { command: 'npm run build' }, startedAt: 2 } },
        ] },
    ] } });
    usePermissions.setState({ levels: { run_command: 'ask' } });
    void gate('run_command', { command: 'npm run build' }, 'review', { tabId: id, setToolState: (_call, state, extra) => {
      useChatStore.setState(current => ({ byTab: { ...current.byTab, [id]: current.byTab[id]!.map(message => message.id !== 'answer' ? message : {
        ...message, parts: message.parts?.map(part => part.kind !== 'tool' || part.tool.toolCallId !== 'review' ? part : { kind: 'tool', tool: { ...part.tool, ...extra, state } }),
      }) } }));
    } }).then(result => { (window as unknown as { approvalResult: unknown }).approvalResult = result; });
  });
  const thinking = page.locator('.ai-thinking .ai-tool-summary');
  await expect(thinking).toHaveCSS('font-size', '12px');
  await expect(thinking.locator('.ai-tool-description')).toHaveCSS('user-select', 'none');
  const resting = await thinking.evaluate(element => getComputedStyle(element).backgroundColor);
  await thinking.click(); await page.mouse.move(0, 0);
  await expect(thinking).toHaveCSS('background-color', resting);
  await thinking.hover(); await expect(thinking).not.toHaveCSS('background-color', resting);
  await page.mouse.move(0, 0); await expect(thinking).toHaveCSS('background-color', resting);
  const tool = page.locator('.ai-tool-card[data-tool-state="done"]');
  await expect(tool.locator('.ai-tool-state')).toHaveCSS('color', 'rgb(48, 209, 88)');
  const color = await tool.evaluate(element => getComputedStyle(element).backgroundColor);
  await tool.locator('.ai-tool-summary').click(); await page.mouse.move(0, 0);
  await expect(tool).toHaveCSS('background-color', color);
  await tool.hover(); await expect(tool).not.toHaveCSS('background-color', color);
  const approval = page.locator('.ai-tool-card[data-tool-state="approval-pending"]');
  await expect(approval.getByText('Project terminal')).toBeVisible();
  await approval.getByRole('button', { name: '编辑', exact: true }).click();
  await approval.getByRole('textbox', { name: '要运行的命令' }).fill('npm run check');
  await page.screenshot({ path: info.outputPath('approval-edit.png') });
  await approval.getByRole('button', { name: '运行', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { approvalResult: unknown }).approvalResult)).toMatchObject({ proceed: true, command: 'npm run check' });
  await expect(page.getByRole('button', { name: /运行命令 npm run check/ })).toBeVisible();
});
