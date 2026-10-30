import { expect, test, type Page } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

async function call(page: Page, requestId: string, name: string, args: Record<string, unknown>) {
  await expect.poll(() => page.evaluate(async () => {
    const path = '/src/features/chat/stores/harness.ts';
    const { useHarnessStore } = await import(path) as typeof import('../src/features/chat/stores/harness');
    return Object.values(useHarnessStore.getState().byTab).some(session => session.pending && !!session.sessionId);
  })).toBe(true);
  await page.evaluate(async ({ requestId, name, args }) => {
    const path = '/src/features/chat/stores/harness.ts';
    const { useHarnessStore } = await import(path) as typeof import('../src/features/chat/stores/harness');
    const session = Object.values(useHarnessStore.getState().byTab).find(session => session.pending && session.sessionId)!;
    (window as unknown as { __EMIT_EVENT__: (event: string, payload: unknown) => void }).__EMIT_EVENT__('acp://session', {
      sessionId: session.sessionId, kind: 'app-tool', payload: { method: 'call', requestId, name, arguments: args },
    });
  }, { requestId, name, args });
}

async function result(page: Page, requestId: string) {
  return page.evaluate(requestId => (window as unknown as { __APP_MCP_RESULTS__?: Array<{ requestId: string; payload: { isError: boolean; content: Array<{ text: string }> } }> }).__APP_MCP_RESULTS__?.find(item => item.requestId === requestId)?.payload, requestId);
}

async function open(page: Page, theme = 'dark') {
  await setupTauriMock(page, {});
  await page.addInitScript(theme => localStorage.setItem('vrykell-theme-mode', theme), theme);
  await page.goto('/');
  await page.getByTestId('workspace-area-ai').click(); await page.getByTestId('harness-add-session').click();
  await page.getByTestId('acp-launcher-Fake ACP').click();
  await expect(page.getByTestId('harness-composer')).toBeVisible();
  await page.getByRole('button', { name: '会话设置', exact: true }).click();
}

for (const theme of ['dark', 'light']) test(`answers application MCP questions in its transcript without silently binding a terminal in ${theme}`, async ({ page }, info) => {
  await open(page, theme);
  const target = page.getByTestId('harness-execution-target');
  await expect(target).toContainText('讨论');
  for (const width of [640, 1240]) {
    await page.setViewportSize({ width, height: 800 });
    await target.click();
    const popup = page.getByRole('listbox', { name: '应用工具执行终端', exact: true });
    await expect(popup).toBeVisible();
    const bounds = await popup.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(7); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width - 7);
    await page.screenshot({ path: info.outputPath(`application-target-${theme}-${width}.png`) });
    await page.keyboard.press('Escape');
  }
  await page.getByTestId('harness-composer').fill('Ask me before proceeding'); await page.getByTestId('harness-send').click();
  await page.getByRole('button', { name: '会话设置', exact: true }).click();
  await expect(target).toBeDisabled();
  await page.keyboard.press('Escape');
  await call(page, 'unbound', 'run_command', { command: 'echo application-mcp' });
  await expect.poll(async () => (await result(page, 'unbound'))?.isError).toBe(true);
  await call(page, 'question', 'ask_user', { question: 'Which folder should be used?', options: ['Current project', 'Another folder'] });
  const question = page.getByRole('group', { name: '回答问题', exact: true });
  await expect(question).toBeVisible();
  await page.screenshot({ path: info.outputPath('application-mcp-question.png') });
  await question.getByRole('button', { name: 'Current project', exact: true }).click();
  await expect.poll(async () => (await result(page, 'question'))?.isError).toBe(false);
  expect((await result(page, 'question'))?.content[0]?.text).toContain('Current project');
  await call(page, 'repeat', 'ask_user', { question: 'Confirm the same choice again?' });
  await expect.poll(async () => (await result(page, 'repeat'))?.isError).toBe(true);
  await expect(question).toHaveCount(0);
  await page.getByRole('button', { name: '停止本轮', exact: true }).click();
  await page.getByTestId('harness-composer').fill('Ask a new question'); await page.getByTestId('harness-send').click();
  await call(page, 'cancel', 'ask_user', { question: 'Proceed?' });
  await expect(question).toBeVisible();
  await page.getByRole('button', { name: '停止本轮', exact: true }).click();
  await expect(question).toHaveCount(0);
  await expect(page.locator('.ai-tool-card[data-tool-state="cancelled"] .ai-tool-state')).toHaveText('已取消');
  await expect(page.locator('#app-notifications [role="alert"]')).toHaveCount(0);
});

test('uses the explicitly selected terminal and does not bypass shared approval after a refusal', async ({ page }) => {
  await open(page);
  await page.getByTestId('harness-execution-target').click();
  await page.getByRole('option').last().click();
  await expect(page.getByTestId('harness-execution-target')).not.toContainText('讨论');
  await page.getByTestId('harness-composer').fill('Inspect the selected terminal'); await page.getByTestId('harness-send').click();
  await call(page, 'command', 'run_command', { command: 'echo application-mcp' });
  await expect(page.locator('.ai-tool-card')).toHaveAttribute('data-tool-state', 'approval-pending');
  await expect(page.getByRole('button', { name: '运行', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '拒绝', exact: true }).click();
  await expect.poll(async () => (await result(page, 'command'))?.isError).toBe(true);
  await call(page, 'retry', 'read_file', { path: '/home/e2e/project/file.txt' });
  await expect.poll(async () => (await result(page, 'retry'))?.isError).toBe(true);
  expect((await result(page, 'retry'))?.content[0]?.text).toContain('denied');
  await expect(page.getByRole('button', { name: '运行', exact: true })).toHaveCount(0);
});

test('returns an approval review question to the same agent composer', async ({ page }) => {
  await open(page);
  await page.getByTestId('harness-execution-target').click(); await page.getByRole('option').last().click();
  await page.getByTestId('harness-composer').fill('Inspect the terminal'); await page.getByTestId('harness-send').click();
  await call(page, 'review', 'run_command', { command: 'echo review-target' });
  await expect(page.locator('.ai-tool-card')).toHaveAttribute('data-tool-state', 'approval-pending');
  await page.getByRole('button', { name: '先问一下', exact: true }).click();
  await expect(page.getByTestId('harness-composer')).toHaveValue(/echo review-target/);
  await expect(page.getByTestId('harness-composer')).toBeFocused();
  await expect.poll(async () => (await result(page, 'review'))?.isError).toBe(true);
});
