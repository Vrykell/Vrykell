import { test, expect, type Page } from '@playwright/test';
import { mockAnthropic, setupTauriMock, ensureTabsOpen, ptyWrites, ensureChatSettingsOpen } from './tauri-mock';

async function boot(page: Page, reply = 'The build is fixed.') {
  await mockAnthropic(page, reply);
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.locator('[data-terminal-input]')).toBeVisible();
  await page.locator('[data-dock-btn="chat"]').click();
  await expect(page.locator('[data-chat-composer]')).toBeVisible();
  await expect(page.getByRole('button', { name: '会话设置' })).toBeVisible();
}

test('conversation drafts survive terminal navigation, settings and closing the final terminal', async ({ page }) => {
  await boot(page);
  const composer = page.locator('[data-chat-composer]');
  await composer.fill('Fix the project build');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(composer).toHaveValue('Fix the project build');
  await expect(page.locator('[data-dock-btn="chat"]')).toBeVisible();
  await ensureTabsOpen(page);
  await page.getByTestId('tab-row-t1').click();
  await page.getByRole('button', { name: '关闭当前终端', exact: true }).click();
  await expect(composer).toBeVisible();
  await expect(composer).toHaveValue('Fix the project build');
  await composer.press('Enter');
  await expect(page.getByText('The build is fixed.', { exact: true })).toBeVisible();
});

test('history owns separate drafts and messages and restores them after reload', async ({ page }) => {
  await boot(page);
  const composer = page.locator('[data-chat-composer]');
  await composer.fill('Fix the build');
  await composer.press('Enter');
  await expect(page.getByText('The build is fixed.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await expect(composer).toHaveValue('');
  await composer.fill('Second draft');
  await page.getByRole('button', { name: 'AI 对话历史', exact: true }).click();
  await expect(page.getByTestId('ai-history-page')).toBeVisible();
  await page.locator('.ai-history-list').getByText('Fix the build', { exact: true }).click();
  await expect(page.getByText('The build is fixed.', { exact: true })).toBeVisible();
  await expect(composer).toHaveValue('');
  await page.getByRole('button', { name: 'AI 对话历史', exact: true }).click();
  await page.locator('.ai-history-list').getByText('新对话', { exact: true }).click();
  await expect(composer).toHaveValue('Second draft');
  await page.getByRole('button', { name: 'AI 对话历史', exact: true }).click();
  await page.locator('.ai-history-list').getByText('Fix the build', { exact: true }).click();
  await page.reload();
  await expect(page.getByText('The build is fixed.', { exact: true })).toBeVisible();
});

test('the execution environment stays fixed and a closed terminal stays disconnected', async ({ page }) => {
  await boot(page);
  await ensureChatSettingsOpen(page);
  await page.getByRole('combobox', { name: '选择执行终端' }).click();
  await page.getByRole('listbox', { name: '选择执行终端' }).getByRole('option').filter({ hasNotText: '仅讨论' }).first().click();
  const chip = page.getByTestId('chat-execution-target');
  await expect(chip).toBeVisible();
  const selected = await chip.textContent();
  await page.getByRole('button', { name: '新建终端', exact: true }).click();
  await page.getByRole('button', { name: /Bash/ }).click();
  await expect(chip).toHaveText(selected!);
  await ensureTabsOpen(page);
  await page.getByTestId('tab-row-t1').click();
  await page.getByRole('button', { name: '关闭当前终端', exact: true }).click();
  await expect(chip).toContainText('已断开');
  await expect(page.getByText('终端已断开，选择终端后可继续执行。')).toBeVisible();
});

test('rename and delete manage conversation history independently of terminals', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '重命名对话' }).click();
  const title = page.getByRole('textbox', { name: '对话标题' });
  await title.fill('Build investigation');
  await title.press('Enter');
  await expect(page.locator('.chat-conversation-title')).toHaveText('Build investigation');
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await page.getByRole('button', { name: 'AI 对话历史' }).click();
  const row = page.locator('.ai-history-list [data-testid^="conversation-row-"]').filter({ hasText: 'Build investigation' });
  await page.getByRole('button', { name: 'AI 对话历史' }).click();
  await expect(page.locator('[data-tab-kind="ai-history"]')).toHaveCount(1);
  await page.getByTestId('ai-history-search').fill('Build investigation');
  await expect(row).toBeVisible();
  await row.hover();
  await row.getByRole('button', { name: '删除对话' }).click();
  await expect(row).toHaveCount(0);
  await expect(page.locator('[data-tab-kind="session"]')).toHaveCount(1);
  await page.locator('[data-tab-kind="session"]').click();
  await expect(page.locator('[data-terminal-input]')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'AI 对话历史' }).click();
  await expect(page.locator('.ai-history-list').getByText('Build investigation')).toHaveCount(0);
});

test('command analysis stages a reference before sending and never changes terminal input', async ({ page }) => {
  await boot(page, 'This is a command snapshot.');
  const terminal = page.locator('[data-terminal-input]');
  await terminal.fill('echo reference-source');
  await terminal.press('Enter');
  const block = page.locator('.command-block').filter({ hasText: 'echo reference-source' }).first();
  await expect(block).toBeVisible();
  await block.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '发给 AI 分析' }).click();
  const composer = page.locator('[data-chat-composer]');
  await expect(composer).toHaveValue('帮我分析这条命令的执行结果。');
  await expect(page.getByText('This is a command snapshot.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '会话设置' })).toBeVisible();
  await expect(page.getByTestId('chat-conversation-context')).toHaveCount(0);
  await page.locator('.chat-composer .chat-reference-toggle').click();
  await expect(page.locator('.chat-composer .chat-reference-body')).toContainText('reference-source');
  await composer.press('Enter');
  await expect(page.getByText('This is a command snapshot.', { exact: true })).toBeVisible();
  expect(await ptyWrites(page)).not.toContain('帮我分析这条命令的执行结果。\n');
  await expect(block).toBeVisible();
});

for (const themePalette of ['dark', 'light'] as const) {
  test(`plain conversation answers remain readable in ${themePalette}`, async ({ page }) => {
    await mockAnthropic(page, 'The build failed because the configuration is missing.\n\n```sh\nnpm run build\n```\n\nCheck the configuration and run the build again.');
    await setupTauriMock(page);
    await page.goto('/');
    if (themePalette === 'light') {
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.locator('aside').getByRole('button', { name: '主题', exact: true }).click();
      await page.getByRole('radio', { name: '浅色', exact: true }).click();
    }
    await page.locator('[data-dock-btn="chat"]').click();
    await page.locator('[data-chat-composer]').fill('Why did the build fail?');
    await page.locator('[data-chat-composer]').press('Enter');
    const exchange = page.locator('.ai-block');
    await expect(exchange.getByText('Check the configuration and run the build again.')).toBeVisible();
    await expect(exchange).not.toHaveClass(/command-block/);
    await expect(exchange).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    expect(await exchange.evaluate(element => getComputedStyle(element, '::before').content)).toBe('none');
    await expect(exchange.locator('.ai-block-heading')).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-theme', themePalette);
    await exchange.locator('.ai-block-question').click();
    await expect(exchange.locator('.ai-block-answer')).toBeVisible();
    await page.locator('.ai-chat-panel').screenshot({ path: `.cache/ai-chat-redesign-${themePalette}.png` });
    await expect(exchange.getByRole('button', { name: '收起回答' })).toHaveCount(0);
    await exchange.hover();
    await exchange.getByRole('button', { name: '更多操作' }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page.getByRole('menu').getByRole('button', { name: '重新生成', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(exchange.locator('.ai-block-answer')).toBeVisible();
  });
}

test('tool activity stays available within the plain conversation flow', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await page.evaluate(async () => {
    const now = Date.now();
    const id = 'tool-row-review';
    const invoke = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke;
    await invoke('save_conversation', { id, title: 'Server discovery', createdAt: now, updatedAt: now, environment: 'null' });
    await invoke('append_conversation_message', { id: 'tool-question', conversationId: id, role: 'user',
      content: 'Help me inspect the services deployed on this server.', createdAt: now, parts: '', attachments: '', paneId: null, context: '{}' });
    const parts = ['hostname; uname -a', 'ss -tulnp'].map((command, index) => ({ kind: 'tool', tool: {
      toolCallId: `tool-${index}`, toolName: 'run_command', input: { command }, state: 'done', startedAt: now + index,
      endedAt: now + index + 1, output: JSON.stringify({ ok: true, exitCode: 0, output: 'Example output' }),
    } }));
    await invoke('append_conversation_message', { id: 'tool-answer', conversationId: id, role: 'assistant', content: '',
      createdAt: now + 1, parts: JSON.stringify(parts), attachments: '', paneId: null, context: '{}' });
    localStorage.setItem('active-ai-conversation', id);
  });
  await page.reload();
  await page.locator('[data-dock-btn="chat"]').click();
  const rows = page.locator('.ai-tool-card');
  await expect(rows).toHaveCount(2);
  const presentation = await rows.first().evaluate(element => ({
    background: getComputedStyle(element).backgroundColor,
    radius: getComputedStyle(element).borderRadius,
    borderTop: getComputedStyle(element).borderTopStyle,
  }));
  // Rows stay flat with no divider lines above or below each tool call.
  expect(presentation).toEqual({ background: 'rgba(0, 0, 0, 0)', radius: '0px', borderTop: 'none' });
  // Expanded output reuses the markdown code-block frame instead of a hairline.
  await rows.first().locator('.ai-tool-summary').click();
  const output = rows.first().locator('.ai-tool-output');
  await expect(output).toBeVisible();
  const frame = await output.evaluate(element => ({
    background: getComputedStyle(element).backgroundColor,
    radius: getComputedStyle(element).borderRadius,
    borderTop: getComputedStyle(element).borderTopStyle,
    paddingLeft: getComputedStyle(element).paddingLeft,
  }));
  expect(frame).toMatchObject({ radius: '8px', borderTop: 'solid', paddingLeft: '12px' });
  expect(frame.background).not.toBe('rgba(0, 0, 0, 0)');
  // One scroll container only: the framed box scrolls, the terminal snapshot inside does not.
  const scroll = await output.evaluate(element => ({
    wrapper: getComputedStyle(element).overflowY,
    inner: getComputedStyle(element.firstElementChild as HTMLElement).overflowY,
  }));
  expect(scroll).toEqual({ wrapper: 'auto', inner: 'hidden' });
  // The copy target sits in the frame corner and appears with the hovered output.
  const copy = page.getByTestId('tool-output-copy');
  await expect(copy).toHaveCSS('opacity', '0');
  await output.hover();
  await expect(copy).toHaveCSS('opacity', '1');
  await expect(copy).toHaveAttribute('data-tip', '复制输出');
  await page.locator('.ai-chat-panel').screenshot({ path: '.cache/ai-tool-frame.png' });
  await expect(page.locator('.ai-block')).not.toHaveClass(/command-block/);
  await expect(page.locator('.ai-block-question')).toHaveCSS('word-break', 'normal');
});

test('reading earlier content pauses automatic scroll until the user returns to the latest reply', async ({ page }) => {
  await boot(page, Array.from({ length: 100 }, (_, index) => `Paragraph ${index}: review the project configuration.\n\n`).join(''));
  await page.locator('[data-chat-composer]').fill('Explain the project');
  await page.locator('[data-chat-composer]').press('Enter');
  const transcript = page.locator('.chat-transcript');
  await expect.poll(() => transcript.evaluate(element => element.scrollHeight)).toBeGreaterThan(1000);
  await transcript.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
  await expect(page.getByRole('button', { name: '回到最新回复' })).toBeVisible();
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeVisible();
  expect(await transcript.evaluate(element => element.scrollTop)).toBeLessThan(10);
  await page.getByRole('button', { name: '回到最新回复' }).click();
  await expect.poll(() => transcript.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(25);
});
