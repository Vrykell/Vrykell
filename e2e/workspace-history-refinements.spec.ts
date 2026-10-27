import { expect, test, type Page } from '@playwright/test';
import { emitPtyOutput, ensureTabsOpen, setupTauriMock } from './tauri-mock';

async function boot(page: Page) {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await ensureTabsOpen(page);
}

test('terminal history opens one singleton tab on the shared workspace surface', async ({ page }) => {
  await boot(page);
  await page.getByTestId('tab-history-btn').click();
  await expect(page.locator('[data-testid="unified-history-page"]:visible')).toBeVisible();
  await expect(page.locator('[data-tab-kind="history"]')).toHaveCount(1);
  await expect(page.getByTestId('history-search-toggle')).toBeVisible();
  // Reopening the entry reuses the same singleton instead of stacking another tab.
  await page.getByTestId('workspace-area-terminal').click();
  await page.getByTestId('tab-history-btn').click();
  await expect(page.locator('[data-tab-kind="history"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="unified-history-page"]:visible')).toBeVisible();
});

test('the history singleton never persists into the terminal tab order', async ({ page }) => {
  await boot(page);
  const ids = await page.evaluate(async () => {
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    const ws = useWorkspaceStore.getState();
    const grouped = ws.tabs[0]!.id;
    const loose = ws.addTab({ title: 'Loose terminal' });
    const second = ws.addTab({ title: 'Second loose terminal' });
    return { grouped, loose, second };
  });
  await ensureTabsOpen(page);
  const order = () => page.locator('[data-reorder-list="session-tabs"] > [data-tab-row-id]').evaluateAll(rows => rows
    .map(row => row.getAttribute('data-tab-row-id')));
  const before = await order();
  expect(before).toEqual(expect.arrayContaining([ids.grouped, ids.loose, ids.second]));
  await page.getByTestId('tab-history-btn').click();
  await expect(page.locator('[data-testid="unified-history-page"]:visible')).toBeVisible();
  await expect(page.locator('[data-tab-kind="history"]')).toHaveCount(1);
  // Closing the singleton restores the session-only order.
  await page.getByTestId('workspace-area-terminal').click();
  const historyRow = page.locator('[data-tab-kind="history"]');
  await historyRow.hover();
  await historyRow.getByRole('button', { name: '关闭标签', exact: true }).click();
  await expect(page.locator('[data-tab-kind="history"]')).toHaveCount(0);
  expect(await order()).toEqual(before);
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

test('history toolbar aligns right and compact search closes on blur', async ({ page }, info) => {
  await boot(page);
  await page.getByTestId('tab-history-btn').click();
  await expect(page.getByTestId('unified-history-page').locator('.history-heading strong')).toHaveText('会话历史');
  const actionButtons = page.locator('.history-actions > button');
  await expect(actionButtons).toHaveCount(5);
  await expect(actionButtons.first()).toHaveAccessibleName('搜索会话');
  const positions = await actionButtons.evaluateAll(elements => elements.map(element => {
    const bounds = element.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right };
  }));
  expect(positions).toEqual([...positions].sort((left, right) => left.left - right.left));
  expect(positions.at(-1)!.right).toBeGreaterThan(1_100);
  await page.screenshot({ path: info.outputPath('history-toolbar.png'), animations: 'disabled' });

  await page.getByTestId('history-search-toggle').click();
  const input = page.getByTestId('unified-history-search');
  await expect(input).toBeVisible();
  await input.fill('旧');
  await expect(page.getByTestId('unified-history-session:hist-1')).toBeVisible();
  await page.locator('.history-heading').click();
  await expect(input).toHaveCount(0);

  await page.getByTestId('workspace-area-ai').click();
  await page.getByTestId('workspace-history').click();
  await expect(page.getByTestId('unified-history-page').locator('.history-heading strong')).toHaveText('全部历史');
});
