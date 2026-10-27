import { test, expect, type Page } from '@playwright/test';
import { setupTauriMock, emitAcpSession, acpUpdate, acpCalls } from './tauri-mock';

const current = (page: Page) => page.locator('[data-testid="harness-page"]:visible');
async function connect(page: Page) {
  await page.getByTestId('workspace-area-ai').click();
  await page.getByTestId('harness-add-session').click();
  await page.getByTestId('acp-launcher-Fake ACP').click();
  await expect(current(page).getByTestId('harness-send')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page, {});
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
});

for (const width of [1240, 760]) {
  test(`keeps provider errors and empty replies visible with working retry at ${width}px`, async ({ page }, info) => {
    await connect(page);
    await page.setViewportSize({ width, height: 800 });
    const surface = current(page);
    await surface.getByTestId('harness-composer').fill('Explain the failure');
    await surface.getByTestId('harness-send').click();
    await emitAcpSession(page, { sessionId: 'sess_e2e', kind: 'error', payload: {
      message: '402: Insufficient Balance', details: 'The provider quota is exhausted.', authRequired: false,
    } });
    const first = surface.locator('.chat-exchange').first();
    await expect(first.getByRole('alert')).toContainText('402: Insufficient Balance');
    await expect(page.locator('[data-error-notification="true"]')).toHaveCount(0);
    const disclosure = first.getByRole('button', { expanded: false }).filter({ hasText: /技术/ });
    await disclosure.click();
    await expect(first.getByRole('alert')).toContainText('The provider quota is exhausted.');
    await page.screenshot({ path: info.outputPath(`acp-reply-error-${width}.png`) });
    await first.getByRole('button', { name: '重试', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await acpCalls(page)).filter(call => call.startsWith('acp_prompt:')).length).toBe(2);
    await emitAcpSession(page, acpUpdate('sess_e2e', { sessionUpdate: 'usage_update', used: 1, size: 100 }));
    await emitAcpSession(page, { sessionId: 'sess_e2e', kind: 'stop', payload: { stopReason: 'end_turn' } });
    const second = surface.locator('.chat-exchange').nth(1);
    await expect(second.getByRole('alert')).toContainText('没有返回回复');
    await expect(first.getByRole('alert')).toContainText('402: Insufficient Balance');
    await second.getByRole('button', { name: '重试', exact: true }).click();
    await emitAcpSession(page, acpUpdate('sess_e2e', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Recovered answer.' } }));
    await emitAcpSession(page, { sessionId: 'sess_e2e', kind: 'stop', payload: { stopReason: 'end_turn' } });
    await expect(surface.locator('.chat-exchange').nth(2)).toContainText('Recovered answer.');
    await expect(surface.getByRole('alert')).toHaveCount(2);
    await expect(surface.getByTestId('harness-send')).toBeVisible();
  });
}

test('reports an unanswered turn even when the agent keeps publishing session metadata', async ({ page }) => {
  await connect(page);
  await page.clock.install();
  const surface = current(page);
  await surface.getByTestId('harness-composer').fill('Waiting for an answer');
  await surface.getByTestId('harness-send').click();
  await emitAcpSession(page, acpUpdate('sess_e2e', { sessionUpdate: 'usage_update', used: 1, size: 100 }));
  const timeout = await page.evaluate(async () => {
    const path = '/src/features/chat/stores/harness.ts';
    const { HARNESS_FIRST_RESPONSE_TIMEOUT_MS } = await import(path) as typeof import('../src/features/chat/stores/harness');
    return HARNESS_FIRST_RESPONSE_TIMEOUT_MS;
  });
  await page.clock.fastForward(timeout);
  await page.clock.fastForward(1300);
  await expect(surface.getByRole('alert')).toContainText('代理长时间没有响应，本轮已停止。');
  await expect.poll(() => acpCalls(page)).toContain('acp_cancel:sess_e2e');
  await expect(surface.getByTestId('harness-send')).toBeVisible();
});

test('renders thoughts, tool actions and final text as one reply without a directory strip', async ({ page }, info) => {
  await connect(page);
  const send = async (update: Record<string, unknown>) => emitAcpSession(page, acpUpdate('sess_e2e', update));
  await send({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Inspect the terminal' } });
  await send({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Checking the target' } });
  await send({ sessionUpdate: 'tool_call', toolCallId: 'inspect', kind: 'execute', title: 'Inspect terminal', status: 'in_progress' });
  await send({ sessionUpdate: 'tool_call_update', toolCallId: 'inspect', status: 'completed' });
  await send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Terminal is ready.' } });
  const surface = current(page);
  await expect(surface.locator('.chat-exchange')).toHaveCount(1);
  await expect(surface.locator('.chat-answer-actions')).toHaveCount(1);
  await expect(surface.getByTestId('harness-directory')).toHaveCount(0);
  await expect(surface).toContainText('Terminal is ready.');
  const probe = await page.evaluate(async () => {
    const path = '/src/platform/diagnostics.ts';
    const { diagnosticSnapshot } = await import(path) as typeof import('../src/platform/diagnostics');
    return diagnosticSnapshot().filter(record => record.event === 'harness-transcript-rendered').at(-1)?.detail;
  });
  expect(probe).toMatchObject({ active: true, exchangeCount: 1, assistantCount: 1, textChars: 18 });
  expect(JSON.stringify(probe)).not.toContain('Terminal is ready.');
  await page.screenshot({ path: info.outputPath('grouped-agent-turn.png') });
});

test('retains drafts and reading positions across workspace and internal session switches', async ({ page }) => {
  await connect(page);
  await current(page).getByTestId('harness-composer').fill('unfinished draft');
  await emitAcpSession(page, acpUpdate('sess_e2e', {
    sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'long output\n\n'.repeat(200) },
  }));
  const body = current(page).locator('.scroll-region');
  await expect.poll(() => body.evaluate(el => el.scrollHeight)).toBeGreaterThan(1000);
  await body.evaluate(el => { el.scrollTop = 300; });
  await expect.poll(() => body.evaluate(el => el.scrollTop)).toBe(300);
  await page.getByTestId('workspace-area-terminal').click();
  await page.getByTestId('workspace-area-ai').click();
  await expect(current(page).getByTestId('harness-composer')).toHaveValue('unfinished draft');
  await expect.poll(() => body.evaluate(el => el.scrollTop)).toBe(300);
  await current(page).getByTestId('harness-new-session').click();
  const sessions = page.getByRole('tablist', { name: 'AI 会话' }).getByRole('tab');
  await expect(sessions).toHaveCount(2);
  await expect(current(page).getByTestId('harness-composer')).toHaveValue('');
  await sessions.first().click();
  await expect(current(page).getByTestId('harness-composer')).toHaveValue('unfinished draft');
  await expect.poll(() => body.evaluate(el => el.scrollTop)).toBe(300);
  await expect(page.getByTestId('workspace-area-ai')).toHaveCount(1);
});

test('shows only usage when opened after a connected session and restores that session draft', async ({ page }, info) => {
  await connect(page);
  const input = current(page).getByTestId('harness-composer');
  await input.fill('retain this draft');
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: '用量统计', exact: true }).click();
  await expect(page.getByTestId('usage-page')).toBeVisible();
  await expect(page.getByTestId('harness-page')).not.toBeVisible();
  const usage = (await page.getByTestId('usage-page').boundingBox())!;
  expect(usage.height).toBeGreaterThan(600);
  await page.screenshot({ path: info.outputPath('usage-with-hidden-agent.png') });
  await page.getByRole('tablist', { name: 'AI 会话' }).getByRole('tab', { name: 'Fake ACP', exact: true }).click();
  await expect(current(page).getByTestId('harness-composer')).toHaveValue('retain this draft');
});

test('follows streamed replies, pauses for reading and offers a return to the latest reply', async ({ page }) => {
  await connect(page);
  await current(page).getByTestId('harness-composer').fill('Explain the result');
  await current(page).getByTestId('harness-send').click();
  for (const text of ['Starting\n\n', 'another paragraph\n\n'.repeat(200)]) {
    await emitAcpSession(page, acpUpdate('sess_e2e', {
      sessionUpdate: 'agent_message_chunk', content: { type: 'text', text },
    }));
  }
  const body = current(page).locator('.scroll-region');
  const gap = () => body.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop);
  await expect.poll(gap).toBeLessThan(5);
  await body.evaluate(el => { el.scrollTop -= 300; });
  await expect.poll(gap).toBeGreaterThan(250);
  const before = await body.evaluate(el => el.scrollTop);
  await emitAcpSession(page, acpUpdate('sess_e2e', {
    sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'more paragraphs\n\n'.repeat(30) },
  }));
  await expect.poll(() => body.evaluate(el => el.scrollTop)).toBe(before);
  await current(page).getByRole('button', { name: '回到最新回复' }).click();
  await expect.poll(gap).toBeLessThan(5);
});

test('opens the focused pane directory instead of the first split pane', async ({ page }) => {
  await page.evaluate(async () => {
    const workspacePath = '/src/features/workspace/stores/workspace.ts';
    const terminalPath = '/src/features/terminal/stores/terminal.ts';
    const { useWorkspaceStore } = await import(workspacePath) as typeof import('../src/features/workspace/stores/workspace');
    const { useTerminalStore } = await import(terminalPath) as typeof import('../src/features/terminal/stores/terminal');
    const state = useWorkspaceStore.getState();
    const active = state.tabs.find(tab => tab.id === state.activeId)!;
    if (active.kind !== 'session') throw new Error('Expected terminal');
    useWorkspaceStore.setState({ tabs: state.tabs.map(tab => tab.id === active.id ? { ...active, layout: {
      type: 'split', dir: 'row', ratio: 0.5,
      first: { type: 'leaf', terminal: { id: 'audit-left', kind: 'local', cwd: 'D:/project-left' } },
      second: { type: 'leaf', terminal: { id: 'audit-right', kind: 'local', cwd: 'D:/project-right' } },
    } } : tab) });
    useTerminalStore.setState({ focusedPaneId: 'audit-right' });
    useWorkspaceStore.getState().openHarnessTab('Fake ACP');
  });
  await expect(current(page).getByTestId('harness-directory')).toHaveCount(0);
  await expect(current(page).locator('[data-tip="D:/project-right"]')).toHaveCount(1);
});

test('asks another conversation even after a matching command shape was approved', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const path = '/src/features/agent/stores/permissions.ts';
    const { gate, resolveApproval, clearSessionGrants } = await import(path) as typeof import('../src/features/agent/stores/permissions');
    const first = await gate('run_command', { command: 'npm run build' }, 'grant-a', {
      tabId: 'conversation-a', shellType: 'powershell', setToolState: (id, state) => {
        if (state === 'approval-pending') queueMicrotask(() => resolveApproval(id, 'shape'));
      },
    });
    let asked = false;
    const second = await gate('run_command', { command: 'npm run test' }, 'grant-b', {
      tabId: 'conversation-b', shellType: 'powershell', setToolState: (id, state) => {
        if (state === 'approval-pending') { asked = true; queueMicrotask(() => resolveApproval(id, 'deny')); }
      },
    });
    clearSessionGrants('conversation-b');
    const again = await gate('run_command', { command: 'npm run test' }, 'grant-a-again', { tabId: 'conversation-a' });
    return { first: first.proceed, asked, second: second.proceed, again: again.proceed };
  });
  expect(result).toEqual({ first: true, asked: true, second: false, again: true });
});

test('keeps failed server edits, saves argument boundaries and persists before leaving settings', async ({ page }) => {
  await page.getByTestId('workspace-area-ai').click();
  await page.getByTestId('harness-add-session').click();
  await expect(page.getByTestId('acp-launcher-Fake ACP')).toBeVisible();
  await page.evaluate(() => {
    const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const original = runtime.invoke;
    let fail = true;
    runtime.invoke = async (command, args) => {
      if (command === 'acp_harness_save' && fail) { fail = false; throw new Error('write failed'); }
      return original(command, args);
    };
  });
  await page.keyboard.press('Control+,');
  await page.getByRole('button', { name: 'ACP', exact: true }).click();
  await page.getByTestId('harness-add').click();
  await page.getByTestId('harness-dialog-name').fill('Saved agent');
  await page.getByTestId('harness-dialog-command').fill('runner');
  await page.getByTestId('harness-dialog-args').fill('D:/folder with spaces\n--test');
  await page.getByTestId('harness-dialog-save').click();
  await expect(page.locator('#app-notifications').getByRole('alert')).toContainText('无法保存服务器');
  await expect(page.getByTestId('harness-dialog-name')).toHaveValue('Saved agent');
  await page.getByTestId('harness-dialog-save').click();
  await expect(page.getByTestId('harness-dialog')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByTestId('harness-add-session').click();
  await expect(page.getByTestId('acp-launcher-Saved agent')).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mock-acp-servers')!) as Array<{ name: string; args: string[] }>);
  expect(saved.find(server => server.name === 'Saved agent')?.args).toEqual(['D:/folder with spaces', '--test']);
  await page.keyboard.press('Control+,');
  await page.getByRole('button', { name: 'ACP', exact: true }).click();
  await expect(page.getByTestId('harness-row-1')).toContainText('Saved agent');
});

test('protects active work and only closes sessions after explicit confirmation', async ({ page }) => {
  await connect(page);
  await current(page).getByTestId('harness-composer').fill('A long task');
  await current(page).getByTestId('harness-send').click();
  const close = page.getByTestId('workspace-instance-bar').getByRole('button', { name: '关闭会话 Fake ACP', exact: true });
  await close.click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('关闭会停止正在进行的任务');
  await page.getByTestId('confirm-cancel').click();
  expect(await acpCalls(page)).not.toContain('acp_close:sess_e2e');
  await close.click();
  await page.getByTestId('confirm-ok').click();
  await expect(current(page)).toHaveCount(0);
  await expect.poll(() => acpCalls(page)).toContain('acp_close:sess_e2e');
});

test('search navigation leaves settings and server dialogs retain keyboard focus', async ({ page }) => {
  await connect(page);
  await page.getByTestId('harness-add-session').click();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: '配置服务器', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('harness-add-session')).toBeFocused();
  await page.keyboard.press('Control+,');
  await page.evaluate(async () => {
    const path = '/src/features/settings/services/registry.ts';
    const { getSettings } = await import(path) as typeof import('../src/features/settings/services/registry');
    getSettings().find(setting => setting.id === 'usage')!.onSelect();
  });
  await expect(page.getByTestId('usage-page')).toBeVisible();
  await expect(page.locator('.settings-screen')).toHaveCount(0);
});

test('keeps connected session controls usable in narrow and wide layouts', async ({ page }, info) => {
  await connect(page);
  for (const width of [1240, 760]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(page.getByRole('tablist', { name: 'AI 会话' })).toBeVisible();
    await expect(current(page).getByTestId('harness-composer')).toBeVisible();
    await page.screenshot({ path: info.outputPath(`acp-workspace-${width}.png`) });
  }
});
