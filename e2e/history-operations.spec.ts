import { expect, test, type Page } from '@playwright/test';
import { ensureTabsOpen, setupTauriMock } from './tauri-mock';
import { fillHistorySearch } from './history-search';

type Probe = Window & {
  __TAURI_INTERNALS__: { invoke: (command: string, args: Record<string, unknown>) => Promise<unknown> };
  __HISTORY_CALLS__: { command: string; id: string }[];
  __CLIPBOARD_TEXT__: string;
};

async function seedSessions(page: Page) {
  await page.evaluate(() => {
    const probe = window as Probe;
    const original = probe.__TAURI_INTERNALS__.invoke;
    const now = Date.now();
    const items = [
      { id: 'alpha', title: 'Deploy Alpha', cwd: '/srv/app' },
      { id: 'beta', title: 'Deploy Beta', cwd: '/srv/app' },
      { id: 'hidden', title: 'Unrelated history', cwd: '/other' },
    ].map((item, index) => ({ ...item, kind: 'local', status: 'historical', created_at: now, closed_at: now - index * 1000,
      payload: '{"shellType":"bash"}', block_count: 0, sort_order: index, group_id: null }));
    probe.__HISTORY_CALLS__ = [];
    probe.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command === 'list_sessions') return [...items];
      if (command === 'get_session' && items.some(item => item.id === args.id)) return items.find(item => item.id === args.id);
      if (command === 'delete_session' || command === 'restore_session') {
        probe.__HISTORY_CALLS__.push({ command, id: String(args.id) });
        const index = items.findIndex(item => item.id === args.id);
        if (index >= 0) {
          if (command === 'delete_session') items.splice(index, 1);
          else items[index].status = 'active';
        }
        return undefined;
      }
      return original(command, args);
    };
  });
}

async function openSessions(page: Page) {
  await ensureTabsOpen(page);
  await page.getByTestId('tab-history-btn').click();
  await expect(page.getByTestId('unified-history-page')).toBeVisible();
}

async function groupSessionsByDirectory(page: Page) {
  await page.getByTestId('unified-history-group-by').click();
  await page.getByTestId('unified-history-group-menu').getByRole('button', { name: '工作目录', exact: true }).click();
}

async function openAiHistory(page: Page) {
  if (!await page.locator('[data-chat-composer]').isVisible()) await page.locator('[data-dock-btn="chat"]').click();
  await page.getByRole('button', { name: 'AI 对话历史', exact: true }).click();
  await expect(page.getByTestId('unified-history-page')).toBeVisible();
}

test('group names, notes, colors and collapse choices survive reload without changing automatic membership', async ({ page }, testInfo) => {
  await setupTauriMock(page, { schedulesSeed: [] });
  await page.goto('/');
  await expect(page.locator('[data-terminal-input]')).toBeVisible();
  await seedSessions(page);
  await openSessions(page);
  await groupSessionsByDirectory(page);
  const card = page.getByTestId('history-group-card-cwd:local::/srv/app');
  await card.getByRole('button', { name: '分组操作' }).click();
  const menu = page.getByRole('menu', { name: '分组操作' });
  const bounds = (await menu.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(bounds.x).toBeGreaterThanOrEqual(8);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height - 8);
  expect(await menu.locator('button').evaluateAll(buttons => buttons.every(button => button.scrollWidth <= button.clientWidth))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('history-group-menu.png'), animations: 'disabled' });
  await menu.getByRole('menuitem', { name: '重命名分组…' }).click();
  const title = page.getByRole('textbox', { name: '分组名称' });
  await title.fill('Servers');
  await title.press('Enter');
  await expect(card.getByRole('heading', { name: 'Servers' })).toBeVisible();
  await expect(card.locator('.history-row')).toHaveCount(2);
  await card.getByRole('button', { name: '分组操作' }).click();
  await page.getByRole('menuitem', { name: '添加分组备注…' }).click();
  const note = page.getByRole('textbox', { name: '分组备注' });
  await note.fill('Follow up after deployment');
  await note.press('Control+Enter');
  await expect(card.locator('.history-group-note')).toHaveText('Follow up after deployment');
  await fillHistorySearch(page, 'unified-history-search', 'Servers');
  await expect(page.locator('.history-row')).toHaveCount(2);
  await fillHistorySearch(page, 'unified-history-search', 'Follow up');
  await expect(page.locator('.history-row')).toHaveCount(2);
  await fillHistorySearch(page, 'unified-history-search', '');
  await card.getByRole('button', { name: '分组颜色', exact: true }).click();
  const palette = page.getByRole('dialog', { name: '分组颜色' });
  const paletteBounds = (await palette.boundingBox())!;
  expect(paletteBounds.x + paletteBounds.width).toBeLessThanOrEqual(viewport.width - 8);
  await palette.getByRole('button', { name: '绿色', exact: true }).click();
  await expect(card).toHaveAttribute('data-group-color', 'green');
  await page.getByTestId('unified-history-actions').click();
  await page.getByRole('menuitem', { name: '收起全部分组' }).click();
  await expect(page.locator('.history-row')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-terminal-input]')).toBeVisible();
  await seedSessions(page);
  await openSessions(page);
  await expect(card).toHaveAttribute('data-collapsed', 'true');
  await expect(card).toHaveAttribute('data-group-color', 'green');
  await expect(card.getByRole('heading', { name: 'Servers' })).toBeVisible();
  await expect(card.locator('.history-group-note')).toHaveText('Follow up after deployment');
  await page.getByTestId('unified-history-actions').click();
  await page.getByRole('menuitem', { name: '展开全部分组' }).click();
  await expect(page.locator('.history-row')).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath('history-group-details.png'), animations: 'disabled' });
  await page.evaluate(async () => {
    const path = '/src/config/typography.ts';
    const { useTypographyStore } = await import(path) as typeof import('../src/config/typography');
    useTypographyStore.getState().update({ uiFontSize: 18 });
  });
  await card.getByRole('button', { name: '分组操作' }).click();
  const largeMenu = page.getByRole('menu', { name: '分组操作' });
  const largeBounds = (await largeMenu.boundingBox())!;
  expect(largeBounds.x + largeBounds.width).toBeLessThanOrEqual(viewport.width - 8);
  expect(largeBounds.y + largeBounds.height).toBeLessThanOrEqual(viewport.height - 8);
  expect(await largeMenu.locator('button').evaluateAll(buttons => buttons.every(button => button.scrollWidth <= button.clientWidth))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('history-group-menu-large-font.png'), animations: 'disabled' });
});

test('filtered group deletion protects locked records across regrouping and restore processes only matching sessions', async ({ page }) => {
  await setupTauriMock(page, { schedulesSeed: [], sshTrustConfirmed: true });
  await page.goto('/');
  await expect(page.locator('[data-terminal-input]')).toBeVisible();
  await seedSessions(page);
  await openSessions(page);
  await groupSessionsByDirectory(page);
  await fillHistorySearch(page, 'unified-history-search', 'Deploy');
  await page.getByTestId('unified-history-session:alpha').hover();
  await page.getByTestId('unified-history-menu-session:alpha').click();
  await page.getByRole('menuitem', { name: '锁定记录', exact: true }).click();
  await page.getByTestId('unified-history-group-by').click();
  await page.getByTestId('unified-history-group-menu').getByRole('button', { name: '终端类型', exact: true }).click();
  await page.keyboard.press('Escape');
  const card = page.getByTestId('history-group-card-terminal:bash');
  await expect(card.locator('.history-row-lock')).toHaveCount(1);
  await page.getByTestId('unified-history-session:alpha').hover();
  await page.getByTestId('unified-history-menu-session:alpha').click();
  await expect(page.getByRole('menuitem', { name: '删除此会话', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await card.getByRole('button', { name: '分组操作' }).click();
  await page.getByRole('menuitem', { name: '删除匹配记录…', exact: true }).click();
  await expect(page.getByTestId('unified-history-session:beta')).toHaveCount(0);
  await expect(page.getByTestId('unified-history-session:alpha')).toBeVisible();
  expect(await page.evaluate(() => (window as Probe).__HISTORY_CALLS__)).toEqual([{ command: 'delete_session', id: 'beta' }]);
  await card.getByRole('button', { name: '分组操作' }).click();
  await page.getByRole('menuitem', { name: '打开匹配记录', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as Probe).__HISTORY_CALLS__)).toEqual([
    { command: 'delete_session', id: 'beta' }, { command: 'restore_session', id: 'alpha' },
  ]);
});

test('AI group copy and deletion use the filtered set while retaining locked and unrelated conversations', async ({ page }) => {
  await setupTauriMock(page, { schedulesSeed: [], sshTrustConfirmed: true });
  await page.goto('/');
  await expect(page.locator('[data-terminal-input]')).toBeVisible();
  await page.evaluate(() => {
    const now = Date.now();
    localStorage.setItem('e2e-conversations', JSON.stringify([
      { id: 'alpha', title: 'Deploy Alpha' }, { id: 'beta', title: 'Deploy Beta' }, { id: 'hidden', title: 'Unrelated discussion' },
    ].map(item => ({ ...item, created_at: now, updated_at: now, environment: 'null' }))));
  });
  await page.reload();
  await expect(page.locator('[data-terminal-input]')).toBeVisible();
  await openAiHistory(page);
  await fillHistorySearch(page, 'unified-history-search', 'Deploy');
  const card = page.locator('.history-group-card');
  await card.getByRole('button', { name: '分组操作' }).click();
  await page.getByRole('menuitem', { name: '复制匹配记录', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as Probe).__CLIPBOARD_TEXT__)).toContain('# Deploy Alpha');
  const copied = await page.evaluate(() => (window as Probe).__CLIPBOARD_TEXT__);
  expect(copied).toContain('# Deploy Beta');
  expect(copied).not.toContain('Unrelated');
  await page.getByTestId('unified-history-conversation:alpha').hover();
  await page.getByTestId('unified-history-menu-conversation:alpha').click();
  await page.getByRole('menuitem', { name: '锁定记录', exact: true }).click();
  await card.getByRole('button', { name: '分组操作' }).click();
  await page.getByRole('menuitem', { name: '删除匹配记录…', exact: true }).click();
  await expect(page.getByTestId('unified-history-conversation:beta')).toHaveCount(0);
  await expect(page.getByTestId('unified-history-conversation:alpha')).toBeVisible();
  await fillHistorySearch(page, 'unified-history-search', '');
  await expect(page.getByTestId('unified-history-conversation:hidden')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('e2e-conversations')!).map((item: { id: string }) => item.id))).toEqual(['alpha', 'hidden']);
});
