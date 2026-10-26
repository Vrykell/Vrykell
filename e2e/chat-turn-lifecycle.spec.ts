import { expect, test } from '@playwright/test';
import { acpCalls, acpUpdate, emitAcpSession, mockAnthropic, paceLlmStream, setupTauriMock } from './tauri-mock';

test('queues native inputs during streaming and stop remains usable for the next turn', async ({ page }) => {
  await mockAnthropic(page, 'A response delivered in several pieces so the next message can wait.');
  await paceLlmStream(page, 80);
  await setupTauriMock(page, { schedulesSeed: [] }); await page.goto('/');
  await page.locator('[data-dock-btn="chat"]').click();
  const composer = page.locator('[data-chat-composer]:visible');
  await composer.fill('First question'); await composer.press('Enter');
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible();
  await composer.fill('Follow-up question'); await composer.press('Enter');
  const queue = page.getByRole('list', { name: '待发送消息', exact: true });
  await expect(queue).toContainText('Follow-up question');
  await expect(composer).toHaveValue('');
  await expect(queue).toHaveCount(0);
  await expect(page.locator('.ai-block-question').filter({ hasText: 'Follow-up question' })).toBeVisible();
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible();
  await composer.fill('Cancel this queued input'); await composer.press('Enter');
  await page.getByRole('button', { name: '停止生成', exact: true }).click();
  await expect(queue).toHaveCount(0);
  await composer.fill('After stop'); await composer.press('Enter');
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '停止生成', exact: true }).click();
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeVisible();
});

for (const theme of ['dark', 'light']) test(`keeps agent sidebar headings and question choices aligned in ${theme}`, async ({ page }, info) => {
  await setupTauriMock(page, { schedulesSeed: [] });
  await page.addInitScript(theme => localStorage.setItem('vrykell-theme-mode', theme), theme);
  await page.goto('/'); await page.locator('[data-dock-btn="chat"]').click();
  const sidebar = page.getByTestId('ai-sidebar-content');
  const heading = sidebar.locator('.chat-conversation-heading');
  const nativeActions = await heading.getByRole('button').evaluateAll(buttons => buttons.slice(-3).map(button => button.getAttribute('aria-label')));
  await heading.getByRole('button', { name: '会话设置', exact: true }).click();
  await page.getByRole('button', { name: '选择智能体', exact: true }).click();
  await page.getByTestId('acp-launcher-Fake ACP').click();
  await expect(sidebar.locator('[data-chat-composer]')).toBeVisible();
  expect(await heading.getByRole('button').evaluateAll(buttons => buttons.slice(-3).map(button => button.getAttribute('aria-label')))).toEqual(nativeActions);
  await page.keyboard.press('Escape');
  await sidebar.locator('[data-chat-composer]').fill('Inspect the project'); await sidebar.locator('[data-chat-composer]').press('Enter');
  await expect(heading).toContainText('Inspect the project');
  await sidebar.locator('[data-chat-composer]').fill('Queued agent input'); await sidebar.locator('[data-chat-composer]').press('Enter');
  await expect(sidebar.getByRole('list', { name: '待发送消息' })).toContainText('Queued agent input');
  expect((await acpCalls(page)).filter(call => call.startsWith('acp_prompt:'))).toHaveLength(1);
  await emitAcpSession(page, { sessionId: 'sess_e2e', kind: 'stop', payload: { stopReason: 'end_turn' } });
  await expect.poll(async () => (await acpCalls(page)).filter(call => call.startsWith('acp_prompt:')).length).toBe(2);
  await page.evaluate(() => (window as unknown as { __EMIT_EVENT__: (name: string, payload: unknown) => void }).__EMIT_EVENT__('acp://session', {
    sessionId: 'sess_e2e', kind: 'app-tool', payload: { method: 'call', requestId: 'spacing', name: 'ask_user', arguments: {
      question: 'Which task should run next?', options: ['Inspect the current project before changing its configuration', 'Create a separate preview and ask before connecting the terminal', 'Continue with the current directory'] },
    },
  }));
  const question = page.getByRole('group', { name: '回答问题', exact: true });
  await expect(question).toBeVisible();
  for (const width of [760, 1320]) {
    await page.setViewportSize({ width, height: 850 });
    const bounds = await question.locator('.ai-question-options button').evaluateAll(buttons => buttons.map(button => {
      const rect = button.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
    }));
    expect(bounds).toHaveLength(3);
    const card = (await question.locator('..').boundingBox())!;
    for (const option of bounds) {
      expect(option.left - card.x).toBeGreaterThanOrEqual(10);
      expect(card.x + card.width - option.right).toBeGreaterThanOrEqual(10);
    }
    for (let index = 1; index < bounds.length; index++) expect(bounds[index].top - bounds[index - 1].bottom).toBeGreaterThanOrEqual(7);
    const input = (await question.getByRole('textbox').boundingBox())!;
    expect(input.y - bounds[2].bottom).toBeGreaterThanOrEqual(11);
    const lead = (await sidebar.locator('.chat-composer-lead').boundingBox())!;
    const add = (await sidebar.getByTestId('harness-new-session').boundingBox())!;
    expect(Math.abs(lead.x + lead.width / 2 - add.x - add.width / 2)).toBeLessThan(1);
    await page.screenshot({ path: info.outputPath(`sidebar-questions-${theme}-${width}.png`) });
  }
  await page.getByRole('button', { name: '停止本轮', exact: true }).click();
  await expect(question).toHaveCount(0);
  await emitAcpSession(page, acpUpdate('sess_e2e', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Ignored after cancellation' } }));
  await expect(page.getByText('Ignored after cancellation', { exact: true })).toHaveCount(0);
});
