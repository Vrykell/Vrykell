import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test('identifies saved agent references separately and resumes them without creating a native conversation', async ({ page }) => {
  await setupTauriMock(page, {});
  await page.addInitScript(() => localStorage.setItem('vrykell-harness-sessions', JSON.stringify({ version: 1, state: { refs: { 'Fake ACP': { sessionId: 'previous-agent-session', cwd: '/home/e2e/project', at: Date.now() } } } })));
  await page.goto('/'); await page.getByTestId('workspace-area-ai').click();
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: 'AI 对话历史' }).click();
  const row = page.getByTestId('unified-history-page').locator('[data-history-kind="agent"]');
  await expect(row).toContainText('Fake ACP'); await expect(row).toContainText('ACP 会话引用');
  await expect(row.locator('[data-app-mark="true"]')).toHaveCount(0);
  await row.hover();
  await row.getByRole('button', { name: '继续 ACP 会话', exact: true }).click();
  await expect(page.locator('[data-testid="harness-page"]:visible')).toBeVisible();
  await expect(page.locator('.ai-chat-panel:not([data-testid="harness-page"]):visible')).toHaveCount(0);
});

test('reads history incrementally on scroll and searches beyond the first page without loading message bodies', async ({ page }) => {
  await setupTauriMock(page, {});
  await page.addInitScript(() => {
    const host = window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> }; __HISTORY_PAGES__: unknown[]; __HISTORY_BODY_READS__: number };
    const invoke = host.__TAURI_INTERNALS__.invoke; host.__HISTORY_PAGES__ = []; host.__HISTORY_BODY_READS__ = 0;
    host.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command === 'list_conversation_messages') host.__HISTORY_BODY_READS__ += 1;
      if (command !== 'history_page') return invoke(command, args);
      const request = args?.request as { limit: number; source: string; cursor: { value: string; key: string } | null };
      host.__HISTORY_PAGES__.push(request);
      const offset = request.cursor ? Number(request.cursor.value) : 0;
      const count = Math.min(request.limit, 125 - offset);
      return { sessions: [], conversations: Array.from({ length: count }, (_, index) => ({ id: `history-${offset + index}`, title: `History ${offset + index}`, created_at: 1, updated_at: 1000 - offset - index, environment: '{}' })),
        nextCursor: offset + count < 125 ? { value: String(offset + count), key: `conversation:history-${offset + count - 1}` } : null };
    };
  });
  await page.goto('/');
  await page.getByTestId('workspace-area-ai').click();
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: 'AI 对话历史' }).click();
  const history = page.getByTestId('unified-history-page');
  await expect(history.locator('[data-history-kind="conversation"]')).toHaveCount(40);
  await expect(history.locator('[data-app-mark="true"]')).toHaveCount(40);
  const list = history.locator('.history-list'); await list.evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')); });
  await expect(history.locator('[data-history-kind="conversation"]')).toHaveCount(80);
  await history.getByTestId('history-search-toggle').click(); await history.getByTestId('unified-history-search').fill('History 124');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __HISTORY_PAGES__: { cursor: { value: string } | null }[] }).__HISTORY_PAGES__.map(request => request.cursor?.value).join(','))).toContain('120');
  await expect(history.getByText('History 124', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __HISTORY_PAGES__: { limit: number }[] }).__HISTORY_PAGES__.every(request => request.limit === 40))).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __HISTORY_BODY_READS__: number }).__HISTORY_BODY_READS__)).toBe(0);
  await expect(page.locator('.workspace-sidebar-footer')).toHaveCSS('border-top-width', '0px');
});
