import { expect, test, type Locator, type Page } from '@playwright/test';
import { ensureTabsOpen, setupTauriMock } from './tauri-mock';

const markerColor = (card: Locator) => card.locator('.history-group-marker').evaluate(element => getComputedStyle(element, '::before').backgroundColor);

async function expectStableRecordHover(record: Locator) {
  const content = record.locator('.sidebar-row-content');
  const background = await content.evaluate(element => getComputedStyle(element).backgroundColor);
  await record.hover();
  await expect(record.locator('.sidebar-row-action')).toHaveCSS('opacity', '1');
  await expect(content).toHaveCSS('background-color', background);
  await expect(record.locator('.sidebar-row-title')).toHaveCSS('text-decoration-line', 'underline');
  await expect(record.locator('.history-row-quick-actions button')).toHaveCount(2);
  await expect(record.locator('.sidebar-row-subtitle')).toBeVisible();
}

async function expectResponsiveTimestamp(card: Locator) {
  const timestamp = card.locator('time');
  await expect(timestamp).toHaveAttribute('datetime', /^\d{4}-/);
  if (await card.evaluate(element => element.clientWidth <= 480)) await expect(timestamp).toBeHidden();
  else await expect(timestamp).toBeVisible();
}

async function seedSessionHistory(page: Page) {
  await page.evaluate(() => {
    const internal = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const original = internal.invoke;
    const now = Date.now();
    const remote = (host: string) => JSON.stringify({ layout: { type: 'leaf', terminal: { kind: 'ssh', cwd: '/srv/app', ssh: { host, user: 'dev' }, openMode: 'classic' } } });
    const items = [
      { id: 'local', title: 'Local Bash', cwd: '/srv/app', payload: '{"shellType":"bash"}' },
      { id: 'cmd', title: 'Local CMD', cwd: 'C:/work', payload: '{"shellType":"cmd"}' },
      { id: 'remote-z', title: 'Deploy Zebra', cwd: '', payload: remote('alpha.test'), created_at: now - 40 * 86400000 },
      { id: 'remote-a', title: 'Deploy Alpha', cwd: '', payload: remote('alpha.test') },
      { id: 'remote-b', title: 'Deploy Beta', cwd: '', payload: remote('beta.test') },
      { id: 'remote-unknown', title: 'Missing directory', cwd: '', payload: '{"ssh":{"host":"unknown.test"}}' },
    ].map((item, index) => ({ status: 'historical', kind: 'local', created_at: now, closed_at: now - index * 1000, block_count: 1, sort_order: index, group_id: 'old-group', ...item }));
    internal.invoke = async (command, args) => command === 'list_sessions' ? items : original(command, args);
  });
}

test('session grouping separates remote directories and combines connection filtering with record sorting', async ({ page }, testInfo) => {
  await setupTauriMock(page, { schedulesSeed: [] });
  await page.goto('/');
  await expect(page.locator('[data-terminal-input]')).toBeVisible();
  await ensureTabsOpen(page);
  await seedSessionHistory(page);
  await page.getByTestId('tab-history-btn').click();
  await expect(page.locator('.history-group-card')).toHaveCount(1);

  const groupBy = page.getByTestId('session-history-group-by');
  await page.screenshot({ path: testInfo.outputPath('history-toolbar-wide.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 900, height: 700 });
  const header = page.locator('.history-header');
  expect((await header.boundingBox())!.height).toBeLessThan(50);
  await groupBy.hover();
  const tooltip = page.getByTestId('app-tooltip');
  await expect(tooltip).toBeVisible();
  const tooltipBounds = await tooltip.boundingBox();
  expect(tooltipBounds!.y).toBeGreaterThanOrEqual(6);
  expect(tooltipBounds!.y + tooltipBounds!.height).toBeLessThanOrEqual(694);
  await page.screenshot({ path: testInfo.outputPath('history-toolbar-narrow-tooltip.png'), animations: 'disabled' });
  await groupBy.click();
  await expect(page.getByTestId('session-group-menu').getByRole('button', { name: '按天', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('session-group-menu').getByRole('button', { name: '工作区分组', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('session-group-menu').getByRole('button', { name: '终端启动模式', exact: true })).toHaveCount(0);
  await page.getByTestId('session-group-menu').getByRole('button', { name: '终端类型', exact: true }).click();
  await expect(page.getByTestId('history-group-card-terminal:bash')).toBeVisible();
  await expect(page.getByTestId('history-group-card-terminal:cmd')).toBeVisible();
  await expect(page.getByTestId('history-group-card-terminal:ssh').locator('.history-row')).toHaveCount(4);
  await groupBy.click();
  await page.getByTestId('session-group-menu').getByRole('button', { name: '工作目录', exact: true }).click();
  await expect(page.locator('.history-group-card')).toHaveCount(5);
  await expect(page.getByRole('heading', { name: '/srv/app', exact: true })).toBeVisible();
  const alpha = page.getByRole('region', { name: 'dev@alpha.test · /srv/app', exact: true });
  await expect(alpha.locator('.history-row')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'dev@beta.test · /srv/app', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'unknown.test · 未记录工作目录', exact: true })).toBeVisible();
  await expectResponsiveTimestamp(alpha);
  const toggle = alpha.getByRole('button', { name: 'dev@alpha.test · /srv/app', exact: true });
  await toggle.click();
  await expect(alpha.locator('.history-row')).toHaveCount(0);
  await toggle.click();
  await expectStableRecordHover(page.getByTestId('history-session-remote-z'));
  const color = await markerColor(alpha);
  await page.getByTestId('session-filter-input').fill('Deploy');
  await page.getByTestId('session-filter-btn').click();
  await page.getByTestId('session-filter-menu').getByRole('button', { name: 'SSH', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.history-group-card')).toHaveCount(2);
  const groupNames = () => page.locator('.history-group-title-text').allTextContents();
  const names = await groupNames();
  for (const [sort, ids] of [['标题正序', ['history-session-remote-a', 'history-session-remote-z']], ['标题倒序', ['history-session-remote-z', 'history-session-remote-a']]] as const) {
    await page.getByTestId('session-sort-btn').click();
    await page.getByTestId('session-sort-menu').getByRole('button', { name: sort, exact: true }).click();
    await expect.poll(() => alpha.locator('.history-row').evaluateAll(rows => rows.map(row => row.getAttribute('data-testid')))).toEqual([...ids]);
    expect(await groupNames()).toEqual(names);
  }
  expect(await markerColor(alpha)).toBe(color);
  await groupBy.click();
  await page.getByTestId('session-group-menu').getByRole('button', { name: '终端类型', exact: true }).click();
  await expect(page.getByTestId('history-group-card-terminal:ssh').locator('.history-row')).toHaveCount(3);
  await expect(page.getByTestId('session-filter-input')).toHaveValue('Deploy');
  await page.getByTestId('session-filter-btn').click();
  await expect(page.getByTestId('session-filter-menu').getByRole('button', { name: 'SSH', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('AI history groups by working directory and conversation type and uses settings card colors', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.locator('[data-terminal-input]')).toBeVisible();
  await page.locator('[data-dock-btn="settings"]').click();
  const settingsCard = page.locator('.settings-group-panel').first();
  await expect(settingsCard).toBeVisible();
  const settingsStyle = await settingsCard.evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, border: style.borderTopColor, radius: style.borderTopLeftRadius };
  });

  await page.evaluate(() => {
    const now = Date.now();
    localStorage.setItem('e2e-conversations', JSON.stringify([
      { id: 'history-local', title: 'Project conversation', created_at: now - 1000, updated_at: now, environment: JSON.stringify({ paneId: 't1', label: 'Project terminal', kind: 'local', cwd: '/home/e2e/project' }) },
      { id: 'history-discussion', title: 'Planning discussion', created_at: now - 2000, updated_at: now - 2000, environment: 'null' },
      { id: 'history-no-cwd', title: 'Local session without directory', created_at: now - 3000, updated_at: now - 3000, environment: JSON.stringify({ paneId: 't1', label: 'Local terminal', kind: 'local', cwd: '' }) },
    ]));
  });
  await page.reload();
  await expect(page.locator('[data-terminal-input]')).toBeVisible();
  await page.locator('[data-dock-btn="chat"]').click();
  await expect(page.locator('[data-chat-composer]')).toBeVisible();
  await page.getByRole('button', { name: 'AI 对话历史', exact: true }).click();
  await expect(page.getByTestId('ai-history-page')).toBeVisible();

  const card = page.locator('.history-group-card').first();
  await expect(card).toBeVisible();
  await expectResponsiveTimestamp(card);
  const historyStyle = await card.evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, border: style.borderTopColor, radius: style.borderTopLeftRadius };
  });
  expect(historyStyle).toEqual(settingsStyle);

  const groupBy = page.getByTestId('ai-history-group-by');
  await groupBy.click();
  await page.getByTestId('ai-history-group-menu').getByRole('button', { name: '工作目录' }).click();
  await expect(page.getByText('/home/e2e/project', { exact: true })).toBeVisible();
  await expect(page.getByText('无工作目录', { exact: true })).toBeVisible();

  await groupBy.click();
  await page.getByTestId('ai-history-group-menu').getByRole('button', { name: '对话类型' }).click();
  await expect(page.locator('.history-group-card')).toHaveCount(2);
  await expect(page.getByText('本地', { exact: true })).toBeVisible();
  await expect(page.getByText('仅讨论 · 不操作终端', { exact: true })).toBeVisible();
  const localCard = page.getByTestId('history-group-card-type:local');
  const discussionCard = page.getByTestId('history-group-card-type:discussion');
  const color = await markerColor(localCard);
  expect(color).not.toBe(await markerColor(discussionCard));
  for (const selector of ['.history-group-count', '.sidebar-row-title', '.history-row-icon']) {
    const localColor = await localCard.locator(selector).first().evaluate(element => getComputedStyle(element).color);
    const discussionColor = await discussionCard.locator(selector).first().evaluate(element => getComputedStyle(element).color);
    expect(localColor).toBe(discussionColor);
    expect(localColor).not.toBe(color);
  }
  await page.getByTestId('ai-history-search').fill('Local session without directory');
  await expect(page.locator('.history-group-card')).toHaveCount(1);
  expect(await markerColor(localCard)).toBe(color);
  const record = page.getByTestId('conversation-row-history-no-cwd');
  await expect(record.locator('.sidebar-row-subtitle')).toBeVisible();
  await expect(record).toHaveAccessibleDescription(/Local terminal/);
  const remove = record.getByRole('button', { name: '更多操作' });
  await expect(remove).toHaveCSS('opacity', '0');
  await expectStableRecordHover(record);
  await page.mouse.move(0, 0);
  await expect(remove).toHaveCSS('opacity', '0');
  await record.focus();
  await expect(remove).toHaveCSS('opacity', '1');
  await record.press('Enter');
  await expect(page.locator('.chat-conversation-title')).toHaveText('Local session without directory');
});

test('session date basis survives title sorting, regrouping and reopening', async ({ page }) => {
  await setupTauriMock(page, { schedulesSeed: [] });
  await page.goto('/');
  await expect(page.locator('[data-terminal-input]')).toBeVisible();
  await ensureTabsOpen(page);
  await seedSessionHistory(page);
  await page.getByTestId('tab-history-btn').click();
  await page.getByTestId('session-filter-input').fill('Deploy');
  await page.getByTestId('session-sort-btn').click();
  await page.getByTestId('session-sort-menu').getByRole('button', { name: '最近创建', exact: true }).click();
  await page.getByTestId('session-filter-btn').click();
  const menu = page.getByTestId('session-filter-menu');
  await expect(menu.getByRole('button', { name: '创建日期', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await menu.getByRole('button', { name: '近 7 天', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.history-row')).toHaveCount(2);
  await page.getByTestId('session-sort-btn').click();
  await page.getByTestId('session-sort-menu').getByRole('button', { name: '标题正序', exact: true }).click();
  await page.getByTestId('session-history-group-by').click();
  await page.getByTestId('session-group-menu').getByRole('button', { name: '终端类型', exact: true }).click();
  await expect(page.getByTestId('history-group-card-terminal:ssh').locator('.history-row')).toHaveCount(2);
  await page.getByTestId('session-filter-btn').click();
  await expect(menu.getByRole('button', { name: '创建日期', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await menu.getByRole('button', { name: '关闭日期', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.history-row')).toHaveCount(3);
  await ensureTabsOpen(page);
  await page.locator('[data-tab-kind="history"]').getByRole('button', { name: '关闭标签', exact: true }).click();
  await page.getByTestId('tab-history-btn').click();
  await expect(page.getByTestId('session-filter-input')).toHaveValue('Deploy');
  await expect(page.getByTestId('history-group-card-terminal:ssh').locator('.history-row')).toHaveCount(3);
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('vrykell-session-history-filter')!));
  expect(saved).toMatchObject({ query: 'Deploy', date: '7d', dateField: 'closed', sort: 'title-asc', groupBy: 'terminal' });
});

test('AI remote directory grouping retains the selected date basis and search after reload', async ({ page }) => {
  await setupTauriMock(page, { schedulesSeed: [] });
  await page.goto('/');
  await expect(page.locator('[data-terminal-input]')).toBeVisible();
  await page.evaluate(() => {
    const now = Date.now();
    const environment = JSON.stringify({ paneId: 'old-remote', label: 'Remote terminal', kind: 'ssh', cwd: '/srv/app', ssh: { host: 'alpha.test', user: 'dev' } });
    localStorage.setItem('e2e-conversations', JSON.stringify([
      { id: 'old-created', title: 'Deploy Alpha', created_at: now - 40 * 86400000, updated_at: now, environment },
      { id: 'new-created', title: 'Deploy Zebra', created_at: now, updated_at: now, environment },
    ]));
  });
  await page.reload();
  await expect(page.locator('[data-terminal-input]')).toBeVisible();
  await page.locator('[data-dock-btn="chat"]').click();
  await page.getByRole('button', { name: 'AI 对话历史', exact: true }).click();
  await page.getByTestId('ai-history-search').fill('Deploy');
  await page.getByTestId('ai-history-group-by').click();
  await page.getByTestId('ai-history-group-menu').getByRole('button', { name: '工作目录', exact: true }).click();
  await expect(page.getByRole('region', { name: 'dev@alpha.test · /srv/app', exact: true }).locator('.history-row')).toHaveCount(2);
  await page.getByTestId('ai-history-sort-btn').click();
  await page.getByTestId('ai-history-sort-menu').getByRole('button', { name: '最近创建', exact: true }).click();
  await page.getByTestId('ai-history-filter-btn').click();
  const menu = page.getByTestId('ai-history-filter-menu');
  await menu.getByRole('button', { name: '近 7 天', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.history-row')).toHaveCount(1);
  await page.getByTestId('ai-history-sort-btn').click();
  await page.getByTestId('ai-history-sort-menu').getByRole('button', { name: '标题正序', exact: true }).click();
  await page.getByTestId('ai-history-filter-btn').click();
  await expect(menu.getByRole('button', { name: '创建日期', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await menu.getByRole('button', { name: '更新日期', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.history-row')).toHaveCount(2);
  await page.getByTestId('ai-history-group-by').click();
  await page.getByTestId('ai-history-group-menu').getByRole('button', { name: '终端类型', exact: true }).click();
  await page.reload();
  await expect(page.locator('[data-terminal-input]')).toBeVisible();
  if (!(await page.getByRole('button', { name: 'AI 对话历史', exact: true }).isVisible())) {
    await page.locator('[data-dock-btn="chat"]').click();
  }
  await page.getByRole('button', { name: 'AI 对话历史', exact: true }).click();
  await expect(page.getByTestId('ai-history-page')).toBeVisible();
  await expect(page.getByTestId('ai-history-search')).toHaveValue('Deploy');
  await expect(page.getByTestId('history-group-card-terminal:ssh').locator('.history-row')).toHaveCount(2);
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('vrykell-ai-history-filter')!));
  expect(saved).toMatchObject({ query: 'Deploy', date: '7d', dateField: 'updated', sort: 'title-asc', groupBy: 'terminal' });
});

test('card metadata stays outside the collapse button at normal and maximum UI font sizes', async ({ page }, testInfo) => {
  await setupTauriMock(page, { schedulesSeed: [] });
  await page.goto('/');
  await expect(page.locator('[data-terminal-input]')).toBeVisible();
  await ensureTabsOpen(page);
  await page.getByTestId('tab-history-btn').click();
  for (const size of [13, 18]) {
    await page.evaluate(async uiFontSize => {
      const path = '/src/config/typography.ts';
      const { useTypographyStore } = await import(path) as typeof import('../src/config/typography');
      useTypographyStore.getState().update({ uiFontSize });
    }, size);
    const card = page.locator('.history-group-card').first();
    const toggle = card.locator('.history-group-toggle');
    await toggle.hover();
    await expect(toggle).toHaveCSS('width', '28px');
    expect(await card.locator('.history-group-count').evaluate(element => element.closest('button') === null)).toBe(true);
    expect(await card.locator('time').evaluate(element => element.closest('button') === null)).toBe(true);
    const fits = await toggle.evaluate(element => {
      const outer = element.getBoundingClientRect();
      const icon = element.querySelector('svg')!.getBoundingClientRect();
      return icon.left >= outer.left + 4 && icon.right <= outer.right - 4 && icon.top >= outer.top + 4 && icon.bottom <= outer.bottom - 4;
    });
    expect(fits).toBe(true);
    await expectResponsiveTimestamp(card);
    await page.screenshot({ path: testInfo.outputPath(`history-meta-${size}.png`), animations: 'disabled' });
  }
});
