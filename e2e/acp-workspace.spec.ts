import { test, expect, type Page } from '@playwright/test';
import { setupTauriMock, emitAcpSession, acpUpdate, acpCalls } from './tauri-mock';

const current = (page: Page) => page.locator('[data-testid="harness-page"]:visible');
async function connect(page: Page, directory?: string) {
  await page.getByTestId('workspace-area-ai').click();
  await page.getByTestId('harness-add-session').click();
  await expect(page.getByTestId('acp-launcher-search')).toBeFocused();
  if (directory) await page.getByTestId('acp-launcher-directory').fill(directory);
  await page.getByTestId('acp-launcher-Fake ACP').click();
  await expect(current(page).getByTestId('harness-send')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page, {});
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 30_000 });
});

test('runs the same agent twice in one project with independent replies, drafts and cancellation', async ({ page }) => {
  await connect(page, '/shared-project');
  await current(page).getByTestId('harness-composer').fill('First task');
  await current(page).getByTestId('harness-send').click();
  await current(page).getByTestId('harness-composer').fill('First draft');
  await connect(page, '/shared-project');
  const sessions = page.getByRole('tablist', { name: 'AI 会话' }).getByRole('tab');
  await expect(sessions).toHaveCount(2);
  await expect(current(page).getByTestId('harness-composer')).toHaveValue('');
  await current(page).getByTestId('harness-composer').fill('Second task');
  await current(page).getByTestId('harness-send').click();
  await expect.poll(() => acpCalls(page)).toEqual(expect.arrayContaining(['acp_prompt:sess_e2e', 'acp_prompt:sess_e2e_2']));
  expect((await acpCalls(page)).filter(call => call === 'acp_open:Fake ACP')).toHaveLength(2);
  expect(await acpCalls(page)).not.toContain('acp_open:Fake ACP:resume');
  await emitAcpSession(page, acpUpdate('sess_e2e', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'First reply' } }));
  await emitAcpSession(page, acpUpdate('sess_e2e_2', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Second reply' } }));
  await expect(current(page)).toContainText('Second reply');
  await expect(current(page)).not.toContainText('First reply');
  await current(page).getByRole('button', { name: '停止本轮' }).click();
  await expect.poll(() => acpCalls(page)).toContain('acp_cancel:sess_e2e_2');
  expect(await acpCalls(page)).not.toContain('acp_cancel:sess_e2e');
  await sessions.first().click();
  await expect(current(page)).toContainText('First reply');
  await expect(current(page)).not.toContainText('Second reply');
  await expect(current(page).getByTestId('harness-composer')).toHaveValue('First draft');
  await expect(current(page).getByRole('button', { name: '停止本轮' })).toBeVisible();
});

for (const kind of ['local', 'ssh'] as const) {
test(`identifies the selected ${kind} terminal separately from the agent workspace`, async ({ page }) => {
  const directory = kind === 'ssh' ? '/srv' : 'D:/local-project';
  const paneId = await page.evaluate(async ({ kind, directory }) => {
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    const state = useWorkspaceStore.getState();
    const tab = state.tabs.find(item => item.id === state.activeId);
    if (tab?.kind !== 'session' || tab.layout.type !== 'leaf') throw new Error('Expected a single terminal');
    const pane = tab.layout.terminal;
    useWorkspaceStore.setState({ tabs: state.tabs.map(item => item.id === tab.id ? { ...tab, layout: {
      type: 'leaf', terminal: { ...pane, kind, shellType: kind === 'ssh' ? 'posix' : 'powershell', cwd: directory,
        ...(kind === 'ssh' ? { ssh: { name: 'Site server', host: 'server.example', user: 'operator', port: 22, aiNotes: 'Site files are under /srv' } } : {}) },
    } } : item), terminalCwds: { ...state.terminalCwds, [pane.id]: directory } });
    return pane.id;
  }, { kind, directory });
  await connect(page);
  await page.evaluate(async id => {
    const path = '/src/features/chat/stores/harness.ts';
    const { useHarnessStore } = await import(path) as typeof import('../src/features/chat/stores/harness');
    useHarnessStore.getState().setExecutionPane(Object.keys(useHarnessStore.getState().byTab)[0], id);
  }, paneId);
  await current(page).getByTestId('harness-composer').fill('Inspect the project directory in this terminal');
  await current(page).getByTestId('harness-send').click();
  await emitAcpSession(page, { sessionId: 'sess_e2e', kind: 'app-tool', payload: {
    method: 'call', requestId: 'context-screen', name: 'read_terminal', arguments: {},
  } });
  const results = () => page.evaluate(() => (window as unknown as { __APP_MCP_RESULTS__?: Array<{ requestId: string; payload: { isError: boolean; content: Array<{ text: string }> } }> }).__APP_MCP_RESULTS__ ?? []);
  await expect.poll(async () => (await results()).some(result => result.requestId === 'context-screen')).toBe(true);
  const screen = (await results()).find(result => result.requestId === 'context-screen')!.payload;
  expect(screen.isError).toBe(false);
  expect(JSON.parse(screen.content[0].text)).toMatchObject({ executionContext: {
    agentWorkspaceDirectory: expect.stringContaining('/acp-workspace/'),
    terminal: { kind, cwd: directory, shellType: kind === 'ssh' ? 'posix' : 'powershell',
      ...(kind === 'ssh' ? { ssh: { host: 'server.example', user: 'operator', port: 22 } } : {}) },
    guidance: expect.stringContaining(`The selected application terminal is ${kind === 'ssh' ? 'SSH' : 'local'}.`),
  } });
  if (kind === 'local') return;
  await emitAcpSession(page, { sessionId: 'sess_e2e', kind: 'app-tool', payload: {
    method: 'call', requestId: 'wrong-local-file', name: 'list_dir', arguments: { path: '/srv' },
  } });
  await expect.poll(async () => (await results()).some(result => result.requestId === 'wrong-local-file')).toBe(true);
  const failure = (await results()).find(result => result.requestId === 'wrong-local-file')!.payload;
  expect(failure.isError).toBe(true);
  expect(failure.content[0].text).toContain('existing SSH session');
  expect(failure.content[0].text).toContain('application.run_command');
});
}

test('matches structured question cards to ordinary tool questions in both themes and widths', async ({ page }, info) => {
  await connect(page);
  await current(page).getByTestId('harness-composer').fill('Ask before changing files');
  await current(page).getByTestId('harness-send').click();
  await emitAcpSession(page, { sessionId: 'sess_e2e', kind: 'app-tool', payload: {
    method: 'call', requestId: 'ordinary-question', name: 'ask_user', arguments: { question: 'Choose the changes', options: ['All changes', 'Cache only'] },
  } });
  await emitAcpSession(page, { sessionId: 'sess_e2e', kind: 'elicitation', payload: {
    requestId: 'structured-question', form: { message: 'Choose the changes', fields: [
      { key: 'scope', title: 'Scope', kind: 'string', required: true, options: [
        { value: 'all', label: 'All changes', description: 'Navigation and caching' },
        { value: 'cache', label: 'Cache only', description: '' },
      ], default: '', description: '', minimum: null, maximum: null, minLength: 0, maxLength: 4000, minItems: 0, maxItems: 0 },
    ] },
  } });
  const surface = current(page);
  const card = surface.getByTestId('harness-question');
  const ordinary = surface.locator('.ai-tool-card[data-tool-state="input-pending"]:not([data-testid="harness-question"])');
  await expect(ordinary).toBeVisible();
  await expect(card.getByText('等待回答')).toBeVisible();
  const metrics = (element: Element) => {
    const cardStyle = getComputedStyle(element);
    const header = getComputedStyle(element.querySelector('.ai-tool-summary')!);
    const body = getComputedStyle(element.querySelector('.ai-user-question')!);
    return { background: cardStyle.backgroundColor, radius: cardStyle.borderRadius, margin: cardStyle.margin,
      headerPadding: header.padding, headerFont: header.fontSize, bodyPadding: body.padding, bodyGap: body.gap, bodyFont: body.fontSize, lineHeight: body.lineHeight };
  };
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate(async value => {
      const path = '/src/config/theme/tokens.ts';
      const { applyTheme } = await import(path) as typeof import('../src/config/theme/tokens');
      applyTheme(value);
    }, theme);
    for (const width of [1240, 760]) {
      await page.setViewportSize({ width, height: 900 });
      await page.mouse.move(0, 0);
      await expect.poll(async () => JSON.stringify(await card.evaluate(metrics)) === JSON.stringify(await ordinary.evaluate(metrics))).toBe(true);
      const bounds = (await card.boundingBox())!;
      const reference = (await ordinary.boundingBox())!;
      expect(Math.abs(bounds.x - reference.x)).toBeLessThan(1);
      expect(Math.abs(bounds.width - reference.width)).toBeLessThan(1);
      const choices = card.getByRole('button', { pressed: false }).filter({ hasText: /All changes|Cache only/ });
      const first = (await choices.nth(0).boundingBox())!;
      const second = (await choices.nth(1).boundingBox())!;
      expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
      expect(Math.abs(second.x - first.x)).toBeLessThan(1);
      await page.screenshot({ path: info.outputPath(`acp-question-${theme}-${width}.png`) });
    }
  }
  await card.getByRole('button', { name: 'Cache only', exact: true }).focus();
  await page.keyboard.press('Enter');
  await card.getByRole('button', { name: '发送回答' }).focus();
  await page.keyboard.press('Enter');
  await expect(card).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __ELICITATION_ANSWERS__: unknown[] }).__ELICITATION_ANSWERS__)).toEqual([
    { sessionId: 'sess_e2e', requestId: 'structured-question', response: { action: 'accept', content: { scope: 'cache' } } },
  ]);
  await ordinary.getByRole('button', { name: 'All changes', exact: true }).click();
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

test('grows the composer box with its content like the terminal and AI composers', async ({ page }) => {
  await connect(page);
  const surface = current(page);
  const input = surface.getByTestId('harness-composer');
  const boxHeight = () => input.evaluate(el => el.getBoundingClientRect().height);
  const initial = await boxHeight();
  await input.fill('one\ntwo\nthree');
  const grown = await boxHeight();
  expect(grown).toBeGreaterThan(initial);
  // The shared 120px cap: long input scrolls inside the box instead of growing the page.
  await input.fill(Array.from({ length: 40 }, (_, index) => `line ${index}`).join('\n'));
  const capped = await boxHeight();
  expect(capped).toBeLessThanOrEqual(130);
  expect(capped).toBeGreaterThanOrEqual(grown);
  const overflow = await input.evaluate(el => ({ scroll: el.scrollHeight, client: el.clientHeight }));
  expect(overflow.scroll).toBeGreaterThan(overflow.client + 100);
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
  await expect(current(page).locator('.chat-exchange')).toContainText('another paragraph');
  await expect.poll(() => body.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(300);
  await expect.poll(gap).toBeLessThan(5);
  await body.evaluate(el => { el.scrollTop -= 300; });
  await expect.poll(gap).toBeGreaterThan(250);
  const before = await body.evaluate(el => el.scrollTop);
  await emitAcpSession(page, acpUpdate('sess_e2e', {
    sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'more paragraphs\n\n'.repeat(30) },
  }));
  await expect(current(page).locator('.chat-exchange')).toContainText('more paragraphs');
  await expect.poll(() => body.evaluate(el => el.scrollTop)).toBe(before);
  await current(page).getByRole('button', { name: '回到最新回复' }).click();
  await expect.poll(gap).toBeLessThan(5);
});

test('starts a new agent in the default workspace instead of a terminal directory', async ({ page }) => {
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
  await expect(current(page).locator('[data-tip^="C:/Users/e2e/AppData/Local/com.vrykell.app/acp-workspace/"]')).toHaveCount(1);
  await expect(current(page).locator('[data-tip="D:/project-right"]')).toHaveCount(0);
  const connectionCwd = await page.evaluate(async () => {
    const { useHarnessWorkspace } = await import('/src/features/chat/stores/harnessWorkspace.ts') as typeof import('../src/features/chat/stores/harnessWorkspace');
    return useHarnessWorkspace.getState().connections[0]?.cwd;
  });
  expect(connectionCwd).toBe('');
});

test('sends an attached image with the prompt', async ({ page }) => {
  await connect(page);
  await page.evaluate(() => { (window as unknown as { __PICK_PATHS__: string[] }).__PICK_PATHS__ = ['/home/e2e/shot.png']; });
  const surface = current(page);
  await surface.getByTestId('harness-add-attachment').click();
  const tray = surface.locator('.chat-attachments').first();
  await expect(tray).toContainText('shot.png');
  await surface.getByTestId('harness-composer').fill('What is in this image?');
  await surface.getByTestId('harness-send').click();
  await expect.poll(async () => (await acpCalls(page)).filter(call => call.startsWith('acp_prompt:'))).toEqual(['acp_prompt:sess_e2e:images:1']);
  await expect(surface.locator('.chat-question-attachments')).toContainText('shot.png');
});

test('keeps the draft and attachment after a failed read and allows retry', async ({ page }) => {
  await connect(page);
  await page.evaluate(() => { (window as unknown as { __PICK_PATHS__: string[] }).__PICK_PATHS__ = ['/home/e2e/shot.png']; });
  const surface = current(page);
  await surface.getByTestId('harness-add-attachment').click();
  await expect(surface.locator('.chat-attachments').first()).toContainText('shot.png');
  await surface.getByTestId('harness-composer').fill('Keep this question');
  await page.evaluate(() => { (window as unknown as { __READ_ATTACHMENT_FAIL__: boolean }).__READ_ATTACHMENT_FAIL__ = true; });
  await surface.getByTestId('harness-send').click();
  const notice = page.getByRole('status').filter({ hasText: 'shot.png' });
  await expect(notice).toBeVisible();
  await expect(surface.getByTestId('harness-composer')).toHaveValue('Keep this question');
  await expect(surface.locator('.chat-attachments').first()).toContainText('shot.png');
  expect((await acpCalls(page)).filter(call => call.startsWith('acp_prompt:'))).toEqual([]);
  await notice.getByRole('button', { name: '关闭通知' }).click();
  await page.evaluate(() => { (window as unknown as { __READ_ATTACHMENT_FAIL__: boolean }).__READ_ATTACHMENT_FAIL__ = false; });
  await surface.getByTestId('harness-send').click();
  await expect(surface.getByTestId('harness-composer')).toHaveValue('');
  await expect.poll(async () => (await acpCalls(page)).filter(call => call.startsWith('acp_prompt:')).length).toBe(1);
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
  await expect(page.getByTestId('acp-launcher-search')).toBeFocused();
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
