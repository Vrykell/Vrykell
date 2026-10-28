import { expect, test } from '@playwright/test';
import { acpCalls, acpUpdate, emitAcpSession, mockAnthropic, paceLlmStream, searchCalls, setupTauriMock } from './tauri-mock';
import { pickPlacementZone } from './placement';

for (const split of [false, true]) test(`runs the sidebar alongside ${split ? 'two split' : 'a main'} conversation without sharing stop or queue state`, async ({ page }, info) => {
  await mockAnthropic(page, 'Independent responses keep streaming while another conversation is stopped.');
  await paceLlmStream(page, 500);
  await setupTauriMock(page, {});
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('workspace-area-ai').click();
  await page.getByTestId('ai-new-conversation').click();
  if (split) {
    await page.keyboard.press('Control+d');
    await page.getByRole('menuitem', { name: '新对话', exact: true }).click();
    await pickPlacementZone(page, page.getByTestId('pane-workspace-ai').locator('.unified-pane').first(), 'right');
  }
  await page.locator('[data-dock-btn="chat"]').click();
  const main = page.getByTestId('ai-surface-main');
  const side = page.getByTestId('ai-surface-side');
  const inputs = main.locator('[data-chat-composer]:visible');
  await expect(inputs).toHaveCount(split ? 2 : 1);
  for (let index = 0; index < await inputs.count(); index++) {
    await inputs.nth(index).fill(`Main task ${index}`); await inputs.nth(index).press('Enter');
  }
  const composer = side.locator('[data-chat-composer]:visible');
  await composer.fill('Side task'); await composer.press('Enter');
  await expect(main.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(split ? 2 : 1);
  await expect(side.getByRole('button', { name: '停止生成', exact: true })).toBeVisible();
  await expect.poll(async () => (await searchCalls(page)).filter(call => call.cmd === 'llm_stream').length).toBe(split ? 3 : 2);
  await composer.fill('Only queued in sidebar'); await composer.press('Enter');
  const queue = side.getByRole('list', { name: '待发送消息', exact: true });
  await expect(queue).toContainText('Only queued in sidebar');
  await main.getByRole('button', { name: '停止生成', exact: true }).first().click();
  await expect(side.getByRole('button', { name: '停止生成', exact: true })).toBeVisible();
  await expect(queue).toContainText('Only queued in sidebar');
  await expect(main.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(split ? 1 : 0);
  await page.screenshot({ path: info.outputPath('concurrent-conversations.png') });
  await side.getByRole('button', { name: '停止生成', exact: true }).click();
  await expect(queue).toHaveCount(0);
  if (split) await main.getByRole('button', { name: '停止生成', exact: true }).click();
});

test('keeps two connected agent turns independent across main and sidebar surfaces', async ({ page }) => {
  await setupTauriMock(page, {}); await page.goto('/');
  await page.getByTestId('workspace-area-ai').click();
  await page.getByTestId('harness-add-session').click(); await page.getByTestId('acp-launcher-Fake ACP').click();
  const main = page.getByTestId('ai-surface-main');
  await page.locator('[data-dock-btn="chat"]').click();
  const side = page.getByTestId('ai-surface-side');
  await side.getByRole('button', { name: '会话设置', exact: true }).click();
  await page.getByRole('button', { name: '选择智能体', exact: true }).click();
  await page.getByTestId('acp-launcher-Fake ACP').click(); await page.keyboard.press('Escape');
  await main.getByTestId('harness-composer').fill('Main agent task'); await main.getByTestId('harness-composer').press('Enter');
  await side.getByTestId('harness-composer').fill('Side agent task'); await side.getByTestId('harness-composer').press('Enter');
  await expect(main.getByRole('button', { name: '停止本轮', exact: true })).toBeVisible();
  await expect(side.getByRole('button', { name: '停止本轮', exact: true })).toBeVisible();
  expect((await acpCalls(page)).filter(call => call.startsWith('acp_prompt:'))).toHaveLength(2);
  await emitAcpSession(page, acpUpdate('sess_e2e', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Main agent result' } }));
  await emitAcpSession(page, { sessionId: 'sess_e2e', kind: 'stop', payload: { stopReason: 'end_turn' } });
  await expect(main).toContainText('Main agent result');
  await expect(main.getByRole('button', { name: '停止本轮', exact: true })).toHaveCount(0);
  await expect(side.getByRole('button', { name: '停止本轮', exact: true })).toBeVisible();
  await emitAcpSession(page, acpUpdate('sess_e2e_2', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Side agent result' } }));
  await emitAcpSession(page, { sessionId: 'sess_e2e_2', kind: 'stop', payload: { stopReason: 'end_turn' } });
  await expect(side).toContainText('Side agent result');
  await expect(main).not.toContainText('Side agent result');
  await expect(side).not.toContainText('Main agent result');
});

test('recovers from two connection failures without adding duplicate messages', async ({ page }) => {
  await mockAnthropic(page, 'Recovered after retry');
  await setupTauriMock(page, {});
  await page.addInitScript(() => { (window as unknown as { __AI_CONNECTION_FAILURES__: unknown }).__AI_CONNECTION_FAILURES__ = { remaining: 2, retryable: true }; });
  await page.goto('/'); await page.locator('[data-dock-btn="chat"]').click();
  const side = page.getByTestId('ai-surface-side');
  const composer = side.locator('[data-chat-composer]:visible');
  await composer.fill('Retry this connection'); await composer.press('Enter');
  await expect(side.getByRole('button', { name: '停止生成', exact: true })).toBeVisible();
  await expect(side.locator('.ai-block-answer')).toContainText('Recovered after retry', { timeout: 12_000 });
  await expect(side.locator('.ai-block-question')).toHaveCount(1);
  expect((await searchCalls(page)).filter(call => call.cmd === 'llm_stream')).toHaveLength(3);
  await expect(side.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0);
});

test('reports an exhausted connection retry and keeps manual retry available', async ({ page }) => {
  await mockAnthropic(page, 'Manual retry succeeded');
  await setupTauriMock(page, {});
  await page.addInitScript(() => { (window as unknown as { __AI_CONNECTION_FAILURES__: unknown }).__AI_CONNECTION_FAILURES__ = { remaining: 3, retryable: true }; });
  await page.goto('/'); await page.locator('[data-dock-btn="chat"]').click();
  const side = page.getByTestId('ai-surface-side');
  const composer = side.locator('[data-chat-composer]:visible');
  await composer.fill('Try connecting'); await composer.press('Enter');
  await expect(side.getByRole('button', { name: '重试', exact: true })).toBeVisible({ timeout: 12_000 });
  expect((await searchCalls(page)).filter(call => call.cmd === 'llm_stream')).toHaveLength(3);
  await side.getByRole('button', { name: '重试', exact: true }).click();
  await expect(side.locator('.ai-block-answer')).toContainText('Manual retry succeeded');
  await expect(side.locator('.ai-block-question')).toHaveCount(1);
});
