import { expect, test } from '@playwright/test';
import { armToolCall, clipboardText, ensureChatSettingsOpen, mockAnthropic, mockAnthropicToolCall, setupTauriMock } from './tauri-mock';

test('chooses an execution profile from the AI settings menu without creating a default terminal', async ({ page }) => {
  await mockAnthropic(page, 'Ready');
  await setupTauriMock(page, { schedulesSeed: [] });
  await page.goto('/');
  await page.locator('[data-dock-btn="chat"]').click();
  await ensureChatSettingsOpen(page);
  await page.getByTestId('chat-execution-target').click();
  const before = await page.evaluate(() => (window as unknown as { __PTY_SPAWNS__: unknown[] }).__PTY_SPAWNS__.length);
  await page.getByRole('button', { name: '新建标签页', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '新建标签页', exact: true });
  await expect(picker).toBeVisible();
  const settings = page.getByRole('dialog', { name: '会话设置', exact: true });
  await expect(settings).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __PTY_SPAWNS__: unknown[] }).__PTY_SPAWNS__.length)).toBe(before);
  await picker.getByTestId('new-tab-option-shell:bash').click();
  await expect(settings).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  await expect(page.locator('[data-chat-composer]')).toBeVisible();
  await expect(page.getByTestId('chat-conversation-context')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __PTY_SPAWNS__: unknown[] }).__PTY_SPAWNS__.length)).toBe(before + 1);
});

for (const answer of ['option', 'custom', 'skip', 'cancel'] as const) test(`asks the user inside the conversation and handles ${answer}`, async ({ page }, info) => {
  await mockAnthropic(page, 'Thanks, I have the information.');
  await mockAnthropicToolCall(page, 'ask_user', { question: 'Which environment should I inspect?', options: ['Preview', 'Production'] });
  await setupTauriMock(page, { schedulesSeed: [] }); await page.goto('/');
  await page.locator('[data-dock-btn="chat"]').click();
  const composer = page.locator('[data-chat-composer]:visible');
  await composer.fill('Ask before continuing'); await composer.press('Enter');
  const question = page.getByRole('group', { name: '回答问题', exact: true });
  await expect(question).toBeVisible();
  await expect(page.getByRole('button', { name: '允许一次', exact: true })).toHaveCount(0);
  await expect(page.locator('#app-notifications [role="alert"]')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath(`question-${answer}.png`) });
  if (answer === 'option') await question.getByRole('button', { name: 'Preview', exact: true }).click();
  else if (answer === 'custom') {
    await question.getByRole('textbox', { name: '你的回答' }).fill('Local preview only');
    await question.getByRole('button', { name: '发送回答', exact: true }).click();
  } else if (answer === 'skip') await question.getByRole('button', { name: '跳过问题', exact: true }).click();
  else await page.getByRole('button', { name: '停止生成', exact: true }).click();
  await expect(question).toHaveCount(0);
  if (answer !== 'cancel') await expect(page.getByText('Thanks, I have the information.', { exact: true })).toBeVisible();
  await expect(composer).toBeEnabled();
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0);
  await expect(page.locator('#app-notifications [role="alert"]')).toHaveCount(0);
  if (answer === 'option') {
    await armToolCall(page, 0);
    await page.reload();
    await page.locator('[data-dock-btn="chat"]').click();
    await expect(page.getByRole('group', { name: '回答问题', exact: true })).toHaveCount(0);
  }
});

test('hides leaked spaced tool syntax from streamed answers and copied text without executing it', async ({ page }) => {
  const raw = 'Safe introduction.\n< | DSML | calls>< | DSML | invoke name="run_command">< | DSML | parameter name="command">never-execute-this</ | DSML | parameter></ | DSML | invoke></ | DSML | calls>\nSafe conclusion.';
  await mockAnthropic(page, raw); await setupTauriMock(page, { schedulesSeed: [] }); await page.goto('/');
  await page.locator('[data-dock-btn="chat"]').click();
  await page.locator('[data-chat-composer]:visible').fill('Inspect the answer');
  await page.locator('[data-chat-composer]:visible').press('Enter');
  const exchange = page.locator('.chat-exchange').last();
  await expect(exchange).toContainText('Safe conclusion.');
  await expect(exchange).not.toContainText('DSML');
  await expect(exchange).not.toContainText('never-execute-this');
  await exchange.getByTestId('chat-answer-copy').click();
  expect(await clipboardText(page)).toContain('Safe introduction.');
  expect(await clipboardText(page)).not.toContain('DSML');
  expect(await clipboardText(page)).not.toContain('never-execute-this');
  expect(await page.evaluate(() => (window as unknown as { __PTY_WRITES__: string[] }).__PTY_WRITES__.some(text => text.includes('never-execute-this')))).toBe(false);
});

test('creating an execution target from a common conversation does not replace the conversation pane', async ({ page }) => {
  await setupTauriMock(page, { schedulesSeed: [] }); await page.goto('/');
  await page.getByTestId('workspace-area-unified').click();
  const workspace = page.getByTestId('unified-workspace');
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: '新建工作区标签', exact: true }).click();
  await page.getByRole('menuitem', { name: '新对话', exact: true }).click();
  await ensureChatSettingsOpen(page);
  await page.getByTestId('chat-execution-target').click();
  await page.getByRole('button', { name: '新建标签页', exact: true }).click();
  await page.getByRole('dialog', { name: '新建标签页', exact: true }).getByTestId('new-tab-option-shell:bash').click();
  await expect(workspace.locator('.unified-pane[data-focused="true"][data-resource-id^="chat:"]')).toBeVisible();
  await expect(workspace.locator('[data-chat-composer]')).toBeVisible();
  await expect(page.getByRole('dialog', { name: '会话设置', exact: true })).toBeVisible();
});
