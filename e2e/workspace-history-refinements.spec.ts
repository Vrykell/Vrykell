import { expect, test, type Page } from '@playwright/test';
import { emitPtyOutput, ensureTabsOpen, setupTauriMock } from './tauri-mock';

async function boot(page: Page) {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await ensureTabsOpen(page);
}

async function dragBefore(page: Page, source: string, target: string) {
  const from = (await page.locator(`[data-tab-row-id="${source}"]`).boundingBox())!;
  await page.mouse.move(from.x + 40, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + from.height / 2 + 8);
  const to = (await page.locator(`[data-tab-row-id="${target}"]`).boundingBox())!;
  await page.mouse.move(to.x + 40, to.y + 4, { steps: 6 });
}

test('closing the last tab leaves the workspace empty and closing background sessions preserves the active page', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('Meta+,');
  const settings = page.locator('[data-tab-kind="settings"]');
  const session = page.locator('[data-tab-kind="session"]');
  await session.hover();
  await session.getByRole('button', { name: '关闭标签', exact: true }).click();
  await expect(settings).toBeVisible();
  await expect(page.getByTestId('session-filter-input')).toHaveCount(0);
  await settings.getByRole('button', { name: '关闭标签', exact: true }).click();
  await expect(page.locator('[data-tab-row-id]')).toHaveCount(0);
  await expect(page.getByText('无匹配会话')).toHaveCount(0);
  await expect(page.getByTestId('session-filter-input')).toHaveCount(0);
  await expect(page.getByPlaceholder(/输入命令/)).toHaveCount(0);
  await expect(page.locator('.workspace-main')).toBeVisible();
  await page.getByTestId('tab-history-btn').click();
  await expect(page.getByTestId('session-filter-input')).toBeVisible();
});

test('singleton pages reorder with loose sessions but never enter a group', async ({ page }) => {
  await boot(page);
  const ids = await page.evaluate(async () => {
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    const ws = useWorkspaceStore.getState();
    const grouped = ws.tabs[0]!.id;
    const loose = ws.addTab({ title: 'Loose terminal' });
    const group = await ws.createGroupForTab(grouped, 'Group');
    const settings = ws.addTab({ kind: 'settings' });
    const history = ws.addTab({ kind: 'history' });
    return { grouped, loose, group, settings, history };
  });
  await dragBefore(page, ids.settings, ids.loose);
  await expect(page.locator('[data-reorder-placeholder]')).toHaveCount(1);
  await page.mouse.up();
  const order = () => page.locator('[data-reorder-zone="ungrouped"] [data-tab-row-id]').evaluateAll(rows => rows.map(row => row.getAttribute('data-tab-row-id')));
  await expect.poll(order).toEqual([ids.settings, ids.loose, ids.history]);
  await dragBefore(page, ids.history, ids.settings);
  await page.mouse.up();
  await expect.poll(order).toEqual([ids.history, ids.settings, ids.loose]);
  await dragBefore(page, ids.settings, ids.grouped);
  await expect(page.locator(`[data-group-id="${ids.group}"] [data-reorder-placeholder]`)).toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator(`[data-tab-row-id="${ids.settings}"]`)).toHaveAttribute('data-tab-group', '');
  await expect(page.locator('[data-tab-kind="settings"]')).toHaveCount(1);
  await expect(page.locator('[data-tab-kind="history"]')).toHaveCount(1);
});

test('failed commands remain in history but do not become completion suggestions', async ({ page }) => {
  await boot(page);
  await page.waitForFunction(async () => {
    const path = '/src/features/terminal/stores/terminal.ts';
    const { useTerminalStore } = await import(path) as typeof import('../src/features/terminal/stores/terminal');
    return Object.values(useTerminalStore.getState().startupStates).includes('ready');
  });
  await page.evaluate(async () => {
    const settingsPath = '/src/features/agent/stores/agentSettings.ts';
    const configPath = '/src/features/agent/stores/aiConfig.ts';
    const { useAgentSettings } = await import(settingsPath) as typeof import('../src/features/agent/stores/agentSettings');
    const { useAiConfigStore } = await import(configPath) as typeof import('../src/features/agent/stores/aiConfig');
    useAgentSettings.getState().update({ completeEnabled: true });
    useAiConfigStore.setState({ hasKey: false });
  });
  for (const [command, code] of [['fixture-failed', 127], ['fixture-success', 0]] as const) {
    await emitPtyOutput(page, `\x1b]133;E;${btoa(command)}\x07\x1b]133;C\x07\x1b]133;D;${code}\x07\x1b]133;A\x07$ \x1b]133;B\x07`);
  }
  await expect.poll(() => page.evaluate(async () => {
    const path = '/src/features/terminal/stores/history.ts';
    const { useHistoryStore } = await import(path) as typeof import('../src/features/terminal/stores/history');
    return useHistoryStore.getState().search('fixture-failed').map(entry => entry.exitCode);
  })).toEqual([127]);
  await page.getByPlaceholder(/输入命令/).fill('fixture-');
  await expect(page.locator('.command-completion-suffix')).toHaveText('success');
  await page.getByPlaceholder(/输入命令/).fill('fixture-f');
  await expect(page.locator('.command-completion-suffix')).toHaveCount(0);
});

test('session startup-mode filters combine with sorting and survive reopening', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const internal = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const original = internal.invoke;
    internal.invoke = async (command, args) => {
      if (command !== 'list_sessions') return original(command, args);
      return [
        ['block-a', 'Alpha', 'block', 10], ['block-b', 'Beta', 'block', 20], ['classic', 'Classic', 'classic', 30],
      ].map(([id, title, openMode, closed_at]) => ({ id, title, status: 'historical', kind: 'local', payload: JSON.stringify({ openMode }),
        created_at: 1, closed_at, block_count: 0, sort_order: 0, cwd: '', group_id: null }));
    };
  });
  await page.getByTestId('tab-history-btn').click();
  const rows = () => page.locator('[data-testid^="history-session-"]').evaluateAll(items => items.map(item => item.getAttribute('data-testid')));
  await expect.poll(rows).toEqual(['history-session-classic', 'history-session-block-b', 'history-session-block-a']);
  await page.getByTestId('session-filter-btn').click();
  await page.getByTestId('session-filter-menu').getByRole('button', { name: '块终端', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect.poll(rows).toEqual(['history-session-block-b', 'history-session-block-a']);
  const sortButton = page.getByTestId('session-sort-btn');
  await expect(sortButton).toHaveCSS('width', '28px');
  await sortButton.click();
  const sortMenu = page.getByTestId('session-sort-menu');
  await sortMenu.getByRole('button', { name: '标题正序' }).click();
  await expect.poll(rows).toEqual(['history-session-block-a', 'history-session-block-b']);
  await page.locator('[data-tab-kind="history"]').getByRole('button', { name: '关闭标签', exact: true }).click();
  await page.getByTestId('tab-history-btn').click();
  await expect.poll(rows).toEqual(['history-session-block-a', 'history-session-block-b']);
  await sortButton.click();
  await expect(page.getByTestId('session-sort-menu').getByRole('button', { name: '标题正序' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('session-filter-btn').click();
  await page.getByTestId('session-filter-menu').getByRole('button', { name: '普通终端', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect.poll(rows).toEqual(['history-session-classic']);
});
