import { expect, test, type Locator, type Page } from '@playwright/test';
import { ensureTabsOpen, setupTauriMock } from './tauri-mock';

async function dragTo(page: Page, source: Locator, target: Locator, after = false) {
  await source.scrollIntoViewIfNeeded();
  const start = (await source.boundingBox())!;
  await page.mouse.move(start.x + 20, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + 28, start.y + start.height / 2 + 8, { steps: 3 });
  await target.scrollIntoViewIfNeeded();
  const end = (await target.boundingBox())!;
  await page.mouse.move(end.x + Math.min(40, end.width / 2), end.y + (after ? end.height - 2 : 2), { steps: 8 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page.context(), { launchDirectory: '/home/e2e/project', schedulesSeed: [], sshHost: 'known', terminalDirectories: true });
  await page.addInitScript(() => {
    if (!localStorage.getItem('mock-command-history-runs')) localStorage.setItem('mock-command-history-runs', JSON.stringify([
      { id: 'build', target: 'local', shell: 'system', command: 'npm run build', cwd: '/home/e2e/project', status: 'success', exitCode: 0, timestamp: 3000, runCount: 3 },
      { id: 'tests', target: 'local', shell: 'system', command: 'cargo test', cwd: '/home/e2e/project/src-tauri', status: 'failed', exitCode: 1, timestamp: 2000, runCount: 1 },
      { id: 'noise', target: 'local', shell: 'system', command: 'ls -la', cwd: '/home/e2e/project', status: 'success', exitCode: 0, timestamp: 1000, runCount: 1 },
      { id: 'remote-build', target: JSON.stringify(['ssh', 'prod.example.com', 22, 'root']), shell: 'posix', command: 'make release', cwd: '/srv/app', status: 'success', exitCode: 0, timestamp: 3000, runCount: 1 },
    ]));
  });
  await page.goto('/');
  await page.getByRole('button', { name: '历史命令', exact: true }).click();
  await expect(page.getByTestId('command-history-build')).toBeVisible();
});

test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) {
    console.log(await page.locator('body').innerText());
    await page.screenshot({ path: info.outputPath('failure.png') });
    for (const child of page.context().pages().filter(child => child !== page)) {
      console.log('Tool page', child.url(), await child.locator('body').innerText());
      console.log('Tool operations', await child.evaluate(() => (window as unknown as { __WINDOW_OPS__: unknown[] }).__WINDOW_OPS__));
      console.log('Tool identity', await child.evaluate(() => ({ url: location.href, opener: !!window.opener, metadata: (window as unknown as { __TAURI_INTERNALS__: { metadata: unknown } }).__TAURI_INTERNALS__.metadata })));
      await child.screenshot({ path: info.outputPath('tool-failure.png') });
    }
    console.log('Main operations', await page.evaluate(() => (window as unknown as { __WINDOW_OPS__: unknown[] }).__WINDOW_OPS__));
  }
});

test('uses purposeful sorting submenus and direct settings in wide and narrow history panels', async ({ page }, info) => {
  const panel = page.getByTestId('command-history-panel');
  const group = page.getByTestId('command-group-history');
  for (const width of [1240, 680]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await group.getByRole('button', { name: '未分组命令', exact: true }).evaluate(element => getComputedStyle(element).color))
      .not.toBe(await group.locator('.command-history-group-count').evaluate(element => getComputedStyle(element).color));
    expect(await group.getByRole('button', { name: '未分组命令', exact: true }).evaluate(element => parseFloat(getComputedStyle(element).fontSize)))
      .toBeGreaterThan(await group.locator('.command-history-group-count').evaluate(element => parseFloat(getComputedStyle(element).fontSize)));
    await group.locator('.command-history-section').hover();
    await group.getByRole('button', { name: '分组操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '命令排序', exact: true }).hover();
    await expect(page.getByRole('menuitemradio', { name: '最近使用', exact: true })).toHaveAttribute('aria-checked', 'true');
    for (const menu of await page.getByRole('menu').all()) {
      const bounds = (await menu.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(8); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 8);
    }
    await page.screenshot({ path: info.outputPath(`history-sort-submenu-${width}.png`) });
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await panel.getByRole('button', { name: '历史命令操作', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: '设置', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '历史命令设置', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '隐藏项与排除规则', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`history-actions-${width}.png`) });
    await page.keyboard.press('Escape');
  }
});

test('refreshes the library from the actions menu and the blank list background', async ({ page }) => {
  const panel = page.getByTestId('command-history-panel');
  const menu = page.getByRole('menu', { name: '历史命令操作', exact: true });
  const external = page.getByTestId('command-history-deploy');
  await page.evaluate(() => {
    const runs = JSON.parse(localStorage.getItem('mock-command-history-runs')!) as Record<string, unknown>[];
    runs.push({ id: 'deploy', target: 'local', shell: 'system', command: 'npm run deploy', cwd: '/home/e2e/project', status: 'success', exitCode: 0, timestamp: 4000, runCount: 1 });
    localStorage.setItem('mock-command-history-runs', JSON.stringify(runs));
  });
  await expect(external).toHaveCount(0);

  // The ⋯ menu re-reads preferences and recorded runs
  await panel.getByRole('button', { name: '历史命令操作', exact: true }).click();
  await menu.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(external).toBeVisible({ timeout: 2500 });

  // The blank area below the list opens the same panel menu
  await page.evaluate(() => {
    const runs = JSON.parse(localStorage.getItem('mock-command-history-runs')!) as { id: string }[];
    localStorage.setItem('mock-command-history-runs', JSON.stringify(runs.filter(run => run.id !== 'deploy')));
  });
  await expect(external).toBeVisible();
  const body = (await panel.locator('.command-history-body').boundingBox())!;
  await page.mouse.click(body.x + 40, body.y + body.height - 10, { button: 'right' });
  await menu.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(external).toHaveCount(0, { timeout: 2500 });
});

test('browses, fills, favorites, renames and restores hidden project commands across reloads', async ({ page }) => {
  const panel = page.getByTestId('command-history-panel');
  const before = await page.evaluate(() => (window as unknown as { __PTY_WRITES__: string[] }).__PTY_WRITES__?.length ?? 0);
  await page.getByTestId('command-history-build').dblclick();
  await expect(page.locator('[data-terminal-input]').first()).toHaveValue('npm run build');
  expect(await page.evaluate(() => (window as unknown as { __PTY_WRITES__: string[] }).__PTY_WRITES__?.length ?? 0)).toBe(before);
  await page.getByTestId('command-history-build').getByRole('button', { name: '命令操作' }).click();
  await page.getByRole('button', { name: '保存到收藏', exact: true }).click();
  const favorite = panel.locator('[data-command-history]').filter({ hasText: 'npm run build' });
  await favorite.hover();
  await favorite.getByRole('button', { name: '命令操作' }).click();
  await page.getByRole('button', { name: '重命名命令', exact: true }).click();
  const nameEditor = page.getByRole('dialog', { name: '编辑命令', exact: true });
  const nameField = nameEditor.getByRole('textbox', { name: '命令名称（可选）', exact: true });
  await expect(nameField).toBeFocused();
  await nameField.fill('发布构建');
  await nameEditor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(panel.getByText('发布构建', { exact: true })).toBeVisible();
  await page.getByTestId('command-history-noise').hover();
  await page.getByTestId('command-history-noise').getByRole('button', { name: '命令操作' }).click();
  await page.getByRole('button', { name: '隐藏此命令', exact: true }).click();
  await expect(page.getByTestId('command-history-noise')).toHaveCount(0);
  await page.reload();
  await expect(panel.getByText('发布构建', { exact: true })).toBeVisible();
  await expect(page.getByTestId('command-history-noise')).toHaveCount(0);
  await panel.getByRole('button', { name: '历史命令操作', exact: true }).click();
  await page.getByRole('button', { name: '隐藏项与排除规则', exact: true }).click();
  await page.getByRole('dialog', { name: '隐藏项与排除规则', exact: true }).getByRole('button', { name: '恢复', exact: true }).click();
  await expect(page.getByTestId('command-history-noise')).toBeVisible();
});

test('filters history, generates and revises AI drafts, and offers a choice of execution terminal', async ({ page }) => {
  const panel = page.getByTestId('command-history-panel');
  await panel.getByRole('button', { name: '筛选命令', exact: true }).click();
  await page.getByTestId('command-history-filter-menu').getByRole('button', { name: '失败', exact: true }).click();
  await expect(page.getByTestId('command-history-build')).toHaveCount(0);
  await expect(page.getByTestId('command-history-tests')).toBeVisible();
  await page.getByTestId('command-history-filter-menu').getByRole('button', { name: '全部状态', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.evaluate(() => { (window as unknown as { __AI_REPLY__: string }).__AI_REPLY__ = JSON.stringify({ command: 'npm run build -- --mode production', cwd: '/home/e2e/project', explanation: '**生成生产构建**：运行 `npm run build`。\n\n- 输出到 dist\n- 使用生产配置' }); });
  const popup = page.waitForEvent('popup');
  await panel.getByRole('button', { name: '让 AI 编写', exact: true }).click();
  const tool = await popup;
  await tool.waitForLoadState();
  const reply = await page.evaluate(() => (window as unknown as { __AI_REPLY__: string }).__AI_REPLY__);
  await tool.evaluate(reply => { (window as unknown as { __AI_REPLY__: string }).__AI_REPLY__ = reply; }, reply);
  const composer = tool.getByRole('dialog', { name: '让 AI 编写', exact: true });
  await composer.getByRole('textbox', { name: '描述命令需求' }).fill('生成生产构建命令');
  await composer.getByRole('button', { name: '生成命令', exact: true }).click();
  await expect(composer.getByRole('textbox', { name: '命令草稿' })).toHaveValue('npm run build -- --mode production');
  await expect(composer.locator('.markdown-body strong')).toHaveText('生成生产构建');
  await expect(composer.locator('.markdown-body li')).toHaveCount(2);
  await tool.screenshot({ path: test.info().outputPath('markdown-explanation.png') });
  await page.evaluate(() => { (window as unknown as { __AI_REPLY__: string }).__AI_REPLY__ = JSON.stringify({ command: 'npm run build -- --mode staging', cwd: '/home/e2e/project', explanation: '改为预发布环境。' }); });
  await composer.getByRole('textbox', { name: '描述命令需求' }).fill('改成预发布环境');
  await tool.evaluate(() => { (window as unknown as { __AI_REPLY__: string }).__AI_REPLY__ = JSON.stringify({ command: 'npm run build -- --mode staging', cwd: '/home/e2e/project', explanation: '改为预发布环境。' }); });
  await composer.getByRole('button', { name: '修改命令', exact: true }).click();
  await expect(composer.getByRole('textbox', { name: '命令草稿' })).toHaveValue('npm run build -- --mode staging');
  await composer.getByRole('button', { name: '保存到收藏', exact: true }).click();
  await expect(panel.locator('[data-command-history]').filter({ hasText: 'npm run build -- --mode staging' })).toBeVisible();
  await tool.screenshot({ path: test.info().outputPath('command-history-ai.png') });
  await composer.getByRole('button', { name: '关闭', exact: true }).click();
  await page.evaluate(async () => { const { useCommandHistorySettings } = await import('/src/config/commandHistory.ts'); useCommandHistorySettings.getState().update({ runIn: 'current' }); });
  await page.getByTestId('command-history-tests').hover();
  await page.getByTestId('command-history-tests').click();
  await panel.getByRole('region', { name: '命令详情', exact: true }).getByRole('button', { name: '运行命令' }).click();
  await expect(page.getByRole('alert').getByText('终端目录与命令目录不同，请选择新终端。', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '关闭错误提示', exact: true }).click();
  await page.evaluate(async () => { const { useCommandHistorySettings } = await import('/src/config/commandHistory.ts'); useCommandHistorySettings.getState().update({ runIn: 'new' }); });
  await panel.getByRole('region', { name: '命令详情', exact: true }).getByRole('button', { name: '运行命令' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __PTY_SPAWNS__: { cwd?: string }[] }).__PTY_SPAWNS__.some(spawn => spawn.cwd === '/home/e2e/project/src-tauri'))).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __PTY_WRITES__: string[] }).__PTY_WRITES__.includes('cargo test\n'))).toBe(true);
});

test('filters commands to the current terminal environment and restores them from the card', async ({ page }, info) => {
  await page.evaluate(() => {
    const runs = JSON.parse(localStorage.getItem('mock-command-history-runs')!) as Record<string, unknown>[];
    runs.push({ id: 'pwsh-shortcut', target: 'local', shell: 'pwsh', command: 'Get-ChildItem', cwd: '/home/e2e/project', status: 'success', exitCode: 0, timestamp: 5000, runCount: 1 });
    localStorage.setItem('mock-command-history-runs', JSON.stringify(runs));
  });
  await page.reload();
  const panel = page.getByTestId('command-history-panel');
  const otherShell = page.getByTestId('command-history-pwsh-shortcut');
  await expect(otherShell).toBeVisible();
  await panel.getByRole('button', { name: '筛选命令', exact: true }).click();
  const filterMenu = page.getByTestId('command-history-filter-menu');
  await expect(filterMenu.getByRole('button', { name: '全部环境', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await filterMenu.getByRole('button', { name: '仅相同环境', exact: true }).click();
  await page.screenshot({ path: info.outputPath('history-environment-menu.png') });
  await expect(otherShell).toHaveCount(0);
  await expect(page.getByTestId('command-history-build')).toBeVisible();
  await page.keyboard.press('Escape');
  const card = panel.getByTestId('command-history-filter-environment');
  await expect(card).toContainText('仅相同环境');
  await page.screenshot({ path: info.outputPath('history-environment-filter.png') });
  await card.getByRole('button').click();
  await expect(otherShell).toBeVisible();
  await expect(card).toHaveCount(0);
});

test('keeps SSH and local history separate and fits wide and narrow sidebars', async ({ page }) => {
  const panel = page.getByTestId('command-history-panel');
  await page.evaluate(async () => {
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    const tabId = useWorkspaceStore.getState().addTab({ kind: 'ssh', cwd: '/srv/app', ssh: { name: '生产服务器', host: 'prod.example.com', user: 'root', port: 22, connectionId: 'ssh-1' } });
    const startupPath = '/src/features/terminal/services/terminalStartup.ts';
    const { waitForTerminalStartup } = await import(startupPath) as typeof import('../src/features/terminal/services/terminalStartup');
    await waitForTerminalStartup(`${tabId}#0`);
  });
  await expect(page.getByTestId('command-history-remote-build')).toBeVisible();
  await expect(page.getByTestId('command-history-build')).toHaveCount(0);
  const writesBeforeFill = await page.evaluate(() => (window as unknown as { __PTY_WRITES__: string[] }).__PTY_WRITES__.length);
  await page.getByTestId('command-history-remote-build').dblclick();
  await expect(page.locator('[data-terminal-input]:visible')).toHaveValue('make release');
  expect(await page.evaluate(() => (window as unknown as { __PTY_WRITES__: string[] }).__PTY_WRITES__.length)).toBe(writesBeforeFill);
  await page.screenshot({ path: test.info().outputPath('command-history-wide.png') });
  await page.setViewportSize({ width: 760, height: 800 });
  await expect(panel).toBeVisible();
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('command-history-narrow.png') });
});

test('keeps command rows compact, reveals details without execution and expands searched favorites', async ({ page }) => {
  const panel = page.getByTestId('command-history-panel');
  const row = page.getByTestId('command-history-build');
  expect((await row.boundingBox())!.height).toBeLessThanOrEqual(29);
  await expect(row.locator('.sidebar-row-icon')).toHaveCount(0);
  await expect(row.locator('.sidebar-row-subtitle')).toHaveCount(0);
  const writes = await page.evaluate(() => (window as unknown as { __PTY_WRITES__: string[] }).__PTY_WRITES__.length);
  await row.focus();
  await row.click();
  const details = panel.getByRole('region', { name: '命令详情', exact: true });
  await expect(details.locator('pre')).toHaveText('npm run build');
  await expect(details.getByText('/home/e2e/project', { exact: true })).toBeVisible();
  await expect(page.locator('[data-terminal-input]').first()).toHaveValue('');
  expect(await details.evaluate(element => element.closest('.command-history-body') === null)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __PTY_WRITES__: string[] }).__PTY_WRITES__.length)).toBe(writes);
  await row.press('Enter');
  await expect(page.locator('[data-terminal-input]').first()).toHaveValue('npm run build');
  expect(await page.evaluate(() => (window as unknown as { __PTY_WRITES__: string[] }).__PTY_WRITES__.length)).toBe(writes);
  await details.getByRole('button', { name: '填入命令', exact: true }).press('Escape');
  await expect(details).toHaveCount(0);
  await expect(row).toBeFocused();
  await row.getByRole('button', { name: '命令操作', exact: true }).click();
  await page.getByRole('button', { name: '保存到收藏', exact: true }).click();
  const favorite = panel.locator('[data-command-history]').filter({ hasText: 'npm run build' });
  await panel.getByRole('button', { name: '收起星标命令', exact: true }).click();
  await expect(favorite).toBeHidden();
  await panel.getByRole('textbox', { name: '搜索历史命令', exact: true }).fill('npm');
  await expect(favorite).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('compact-command-favorites.png') });
});

test('remembers folded sections and groups across reloads while saving them after search', async ({ page }) => {
  const panel = page.getByTestId('command-history-panel');
  const history = page.getByTestId('command-group-history');
  await panel.getByRole('button', { name: '历史命令操作', exact: true }).click();
  await page.getByRole('button', { name: '新建命令分组', exact: true }).click();
  const name = page.getByRole('textbox', { name: '重命名命令分组', exact: true });
  await name.fill('Release');
  await name.press('Enter');
  const group = panel.locator('.command-history-group').filter({ has: page.getByRole('button', { name: 'Release', exact: true }) });
  await group.getByRole('button', { name: 'Release', exact: true }).click();
  await history.getByRole('button', { name: '未分组命令', exact: true }).click();
  await expect(page.getByTestId('command-history-build')).toBeHidden();
  await page.screenshot({ path: test.info().outputPath('command-sections-folded.png') });
  await page.reload();
  await expect(history.getByRole('button', { name: '未分组命令', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(group.getByRole('button', { name: 'Release', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('command-history-build')).toBeHidden();
  const search = panel.getByRole('textbox', { name: '搜索历史命令', exact: true });
  await search.fill('npm');
  await expect(page.getByTestId('command-history-build')).toBeVisible();
  await search.fill('');
  await expect(page.getByTestId('command-history-build')).toBeHidden();
});

test('sorts by frequency across reloads and displays full long commands in a narrow sidebar', async ({ page }) => {
  const command = 'npm run build -- --mode production --base /preview/ --outDir dist/production';
  await page.evaluate(command => {
    const runs = JSON.parse(localStorage.getItem('mock-command-history-runs')!) as Record<string, unknown>[];
    runs.push({ id: 'long-command', target: 'local', shell: 'system', command, cwd: '/home/e2e/project', status: 'success', exitCode: 0, timestamp: 500, runCount: 30 });
    localStorage.setItem('mock-command-history-runs', JSON.stringify(runs));
  }, command);
  await page.reload();
  const panel = page.getByTestId('command-history-panel');
  await page.getByTestId('command-history-long-command').waitFor();
  await panel.getByRole('button', { name: '历史命令操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '命令排序', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '最常使用', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(panel.locator('[data-command-history]').first()).toHaveAttribute('data-command-history', 'long-command');
  await page.reload();
  await expect(panel.locator('[data-command-history]').first()).toHaveAttribute('data-command-history', 'long-command');
  const sidebar = page.locator('.workspace-side-panel').filter({ has: panel });
  const previous = (await sidebar.boundingBox())!;
  const handle = (await page.getByTestId('resize-handle-command-history').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 - 240 + previous.width, handle.y + handle.height / 2, { steps: 8 });
  await page.mouse.up();
  const row = page.getByTestId('command-history-long-command');
  await row.focus();
  await row.press('ArrowRight');
  await expect(panel.getByRole('region', { name: '命令详情', exact: true }).locator('pre')).toHaveText(command);
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('compact-command-details-narrow.png') });
});

test('persists command groups, colors and membership through edits and group deletion', async ({ page }) => {
  const panel = page.getByTestId('command-history-panel');
  const row = page.getByTestId('command-history-build');
  await panel.getByRole('button', { name: '历史命令操作', exact: true }).click();
  await page.getByRole('button', { name: '新建命令分组', exact: true }).click();
  const createGroup = page.getByRole('textbox', { name: '重命名命令分组', exact: true });
  await createGroup.fill('Release');
  await createGroup.press('Enter');
  const group = panel.locator('.command-history-group').filter({ has: page.getByRole('button', { name: 'Release', exact: true }) });
  await dragTo(page, row, group.locator('.command-history-section'));
  await expect(group.getByTestId('command-history-build')).toBeVisible();
  const groupTitle = (await group.getByRole('button', { name: 'Release', exact: true }).boundingBox())!;
  const groupCount = (await group.locator('.command-history-group-count').boundingBox())!;
  expect(groupCount.x - groupTitle.x - groupTitle.width).toBeLessThanOrEqual(8);
  expect(groupTitle.width).toBeLessThan((await group.boundingBox())!.width / 2);
  await group.locator('.command-history-section').hover();
  await group.getByRole('button', { name: '分组操作', exact: true }).click();
  const groupMenu = page.getByRole('menu', { name: '分组操作', exact: true });
  await expect(groupMenu.getByRole('menuitem', { name: '分组颜色', exact: true })).toHaveCount(0);
  await expect(groupMenu.getByRole('group', { name: '分组颜色', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('command-group-menu-colors.png') });
  await groupMenu.getByRole('menuitemradio', { name: '蓝色', exact: true }).click();
  await expect(group).toHaveAttribute('data-group-color', 'blue');
  await group.getByRole('button', { name: 'Release', exact: true }).click();
  await expect(row).toBeHidden();
  await panel.getByRole('textbox', { name: '搜索历史命令', exact: true }).fill('npm');
  await expect(group.getByTestId('command-history-build')).toBeVisible();
  await panel.getByRole('textbox', { name: '搜索历史命令', exact: true }).fill('');
  await expect(row).toBeHidden();
  await group.getByRole('button', { name: 'Release', exact: true }).click();
  await row.hover();
  await row.getByRole('button', { name: '命令操作', exact: true }).click();
  await page.getByRole('button', { name: '编辑命令', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '编辑命令', exact: true });
  await editor.getByRole('textbox', { name: '命令', exact: true }).fill('npm run build -- --mode release');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(group.locator('[data-command-history]')).toContainText('npm run build -- --mode release');
  await page.reload();
  await expect(group).toHaveAttribute('data-group-color', 'blue');
  await expect(group.locator('[data-command-history]')).toContainText('npm run build -- --mode release');
  await group.locator('.command-history-section').hover();
  await group.getByRole('button', { name: '分组操作', exact: true }).click();
  const renameGroup = page.getByRole('textbox', { name: '重命名命令分组', exact: true });
  await renameGroup.fill('Deploy');
  await renameGroup.press('Enter');
  const renamed = panel.locator('.command-history-group').filter({ has: page.getByRole('button', { name: 'Deploy', exact: true }) });
  await renamed.locator('.command-history-section').hover();
  await renamed.getByRole('button', { name: '分组操作', exact: true }).click();
  await page.getByRole('button', { name: '删除命令分组', exact: true }).click();
  await page.getByTestId('confirm-ok').click();
  await expect(renamed).toHaveCount(0);
  await expect(panel.locator('[data-command-history]').filter({ hasText: 'npm run build -- --mode release' })).toBeVisible();
});

test('drags commands and groups, filters collected commands and remembers inspector height', async ({ page }) => {
  const panel = page.getByTestId('command-history-panel');
  const createGroup = async (name: string) => {
    await panel.getByRole('button', { name: '历史命令操作', exact: true }).click();
    await page.getByRole('button', { name: '新建命令分组', exact: true }).click();
    const input = page.getByRole('textbox', { name: '重命名命令分组', exact: true });
    await input.fill(name);
    await input.press('Enter');
    return panel.locator('.command-history-group').filter({ has: page.getByRole('button', { name, exact: true }) });
  };
  const release = await createGroup('Release');
  const checks = await createGroup('Checks');
  await dragTo(page, page.getByTestId('command-history-build'), release.locator('.command-history-section'));
  await dragTo(page, page.getByTestId('command-history-tests'), release.getByTestId('command-history-build'), true);
  await expect(release.locator('[data-command-history]')).toHaveCount(2);
  await release.getByRole('button', { name: 'Release', exact: true }).click();
  await expect(release.getByTestId('command-history-build')).toBeHidden();
  await dragTo(page, page.getByTestId('command-history-noise'), release.locator('.command-history-section'));
  await release.getByRole('button', { name: 'Release', exact: true }).click();
  await expect(release.locator('[data-command-history]')).toHaveCount(3);
  await dragTo(page, release.getByTestId('command-history-tests'), checks.locator('.command-history-section'));
  await expect(checks.getByTestId('command-history-tests')).toBeVisible();
  await dragTo(page, checks.getByRole('button', { name: 'Checks', exact: true }), release.locator('.command-history-section'));
  await expect(panel.locator('.command-history-group').filter({ has: page.locator('[data-reorder-handle]') }).first()).toContainText('Checks');
  await page.getByTestId('command-history-build').hover();
  await page.getByTestId('command-history-build').click({ button: 'right' });
  await expect(page.getByRole('button', { name: '移动到命令分组…', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByTestId('command-history-build').click();
  const details = panel.getByRole('region', { name: '命令详情', exact: true });
  const before = (await details.boundingBox())!.height;
  const handle = (await page.getByTestId('resize-command-details').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 - 90, { steps: 8 });
  await page.mouse.up();
  expect((await details.boundingBox())!.height).toBeGreaterThan(before + 70);
  const savedHeight = (await details.boundingBox())!.height;
  await page.reload();
  await page.getByTestId('command-history-build').click();
  expect(Math.abs((await details.boundingBox())!.height - savedHeight)).toBeLessThan(2);
  await details.getByRole('button', { name: '收起命令详情', exact: true }).click();
  await checks.locator('.command-history-section').hover();
  await checks.getByRole('button', { name: '分组操作', exact: true }).click();
  await page.getByRole('button', { name: '移出组内全部命令', exact: true }).click();
  await expect(page.getByTestId('command-group-history').getByTestId('command-history-tests')).toBeVisible();
  await panel.getByRole('button', { name: '筛选命令', exact: true }).click();
  await page.getByTestId('command-history-filter-menu').getByRole('button', { name: '仅星标或已分组', exact: true }).click();
  await page.getByTestId('command-history-filter-menu').getByRole('button', { name: '失败', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(panel.locator('[data-command-history]')).toHaveCount(0);
  await expect(panel.getByText('没有匹配的命令', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(panel.getByRole('button', { name: '设置项目根目录', exact: true })).toHaveText('/home/e2e/project');
  await page.screenshot({ path: test.info().outputPath('command-drag-and-resize.png') });
});

test('centers project tools and fits hover and filter controls at narrow widths', async ({ page }) => {
  const panel = page.getByTestId('command-history-panel');
  const row = page.getByTestId('command-history-build');
  const copy = row.getByRole('button', { name: '复制命令', exact: true });
  await row.hover();
  await copy.hover();
  expect(await copy.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  expect(await copy.locator('..').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  for (const label of ['设置项目根目录']) {
    await panel.getByRole('button', { name: label, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: label, exact: true });
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    const viewport = page.viewportSize()!;
    await expect.poll(async () => { const box = (await dialog.boundingBox())!; return Math.abs(box.x + box.width / 2 - viewport.width / 2); }).toBeLessThan(1);
    await expect.poll(async () => { const box = (await dialog.boundingBox())!; return Math.abs(box.y + box.height / 2 - viewport.height / 2); }).toBeLessThan(1);
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  }
  await panel.getByRole('button', { name: '筛选命令', exact: true }).click();
  await page.getByTestId('command-history-filter-menu').getByRole('button', { name: '成功', exact: true }).click();
  await page.keyboard.press('Escape');
  const heading = panel.getByTestId('command-group-history').locator('.command-history-section');
  const sort = heading.getByRole('button', { name: '未分组命令', exact: true });
  const cards = panel.getByTestId('command-history-filter-chips');
  await expect(cards).toContainText('成功');
  await expect(heading.getByRole('button', { name: '清除筛选', exact: true })).toHaveCount(0);
  expect((await cards.boundingBox())!.y).toBeGreaterThanOrEqual((await panel.locator('.command-history-context').boundingBox())!.y);
  await sort.hover();
  expect(await sort.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('command-history-filter-heading.png') });
  await panel.getByRole('button', { name: '历史命令操作', exact: true }).click();
  await page.getByRole('button', { name: '隐藏项与排除规则', exact: true }).click();
  const rules = page.getByRole('dialog', { name: '隐藏项与排除规则', exact: true });
  await expect(rules).toHaveAttribute('aria-modal', 'true');
  const viewport = page.viewportSize()!;
  await expect.poll(async () => { const box = (await rules.boundingBox())!; return Math.abs(box.x + box.width / 2 - viewport.width / 2); }).toBeLessThan(1);
  await expect.poll(async () => { const box = (await rules.boundingBox())!; return Math.abs(box.y + box.height / 2 - viewport.height / 2); }).toBeLessThan(1);
  await rules.getByRole('combobox', { name: '排除规则类型' }).click();
  await page.getByRole('option', { name: '命令前缀', exact: true }).click();
  await rules.getByRole('textbox', { name: '排除匹配的命令' }).fill('npm run temporary');
  await rules.getByRole('button', { name: '添加排除规则', exact: true }).click();
  await expect(rules.getByText('命令前缀: npm run temporary', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('rules-centered.png') });
  await page.setViewportSize({ width: 680, height: 560 });
  await page.screenshot({ path: test.info().outputPath('rules-centered-narrow.png') });
});

test('keeps favorite-only commands when dragged into history and fits collected filters at minimum width', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem(`mock-command-history-preferences:${JSON.stringify(['local', '/home/e2e/project'])}`, JSON.stringify({
      favorites: [{ id: 'draft', name: 'Preview draft', command: 'npm run preview', cwd: '/home/e2e/project', shell: 'system' }], hidden: [], rules: [], runIn: 'new',
    }));
  });
  await page.reload();
  const panel = page.getByTestId('command-history-panel');
  await dragTo(page, page.getByTestId('command-history-draft'), page.getByTestId('command-group-history').locator('.command-history-section'));
  const moved = page.getByTestId('command-group-history').locator('[data-command-history]').filter({ hasText: 'Preview draft' });
  await expect(moved).toBeVisible();
  await page.reload(); await expect(moved).toBeVisible();
  await page.getByTestId('command-history-build').click({ button: 'right' });
  await page.getByRole('button', { name: '保存到收藏', exact: true }).click();
  await panel.getByRole('button', { name: '筛选命令', exact: true }).click();
  await page.getByTestId('command-history-filter-menu').getByRole('button', { name: '仅星标或已分组', exact: true }).click();
  await page.getByTestId('command-history-filter-menu').getByRole('button', { name: '成功', exact: true }).click();
  await page.keyboard.press('Escape');
  const sidebar = page.locator('.workspace-side-panel').filter({ has: panel });
  const previous = (await sidebar.boundingBox())!;
  const handle = (await page.getByTestId('resize-handle-command-history').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 - 184 + previous.width, handle.y + handle.height / 2, { steps: 8 }); await page.mouse.up();
  const favorites = panel.getByTestId('command-group-favorites');
  expect(await favorites.getByRole('button', { name: '收起星标命令', exact: true }).locator('span').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(panel.getByTestId('command-history-filter-status')).toContainText('成功');
  await expect(panel.getByTestId('command-history-filter-collection')).toContainText('仅星标或已分组');
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('collected-minimum.png') });
});

test('removes filter cards independently in wide and minimum-width layouts', async ({ page }) => {
  const panel = page.getByTestId('command-history-panel');
  await page.getByTestId('command-history-build').click({ button: 'right' });
  await page.getByRole('button', { name: '保存到收藏', exact: true }).click();
  await panel.getByRole('button', { name: '筛选命令', exact: true }).click();
  const menu = page.getByTestId('command-history-filter-menu');
  for (const label of ['成功', '仅星标或已分组', '当前目录', '仅相同环境']) await menu.getByRole('button', { name: label, exact: true }).click();
  await page.keyboard.press('Escape');
  const cards = panel.getByTestId('command-history-filter-chips');
  await expect(cards.getByRole('button')).toHaveCount(4);
  await expect(panel.getByRole('button', { name: '清除筛选', exact: true })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('filter-cards-wide.png') });
  const sidebar = page.locator('.workspace-side-panel').filter({ has: panel });
  const previous = (await sidebar.boundingBox())!;
  const handle = (await page.getByTestId('resize-handle-command-history').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 - 184 + previous.width, handle.y + handle.height / 2, { steps: 8 }); await page.mouse.up();
  for (const card of await cards.locator(':scope > span').all()) {
    expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(card.getByRole('button')).toBeVisible();
  }
  for (const theme of ['dark', 'light'] as const) {
    await page.evaluate(async theme => { const { applyTheme } = await import('/src/config/theme/tokens.ts'); applyTheme(theme); }, theme);
    await page.screenshot({ path: test.info().outputPath(`filter-cards-minimum-${theme}.png`) });
  }
  await cards.getByRole('button', { name: '移除筛选：成功', exact: true }).click();
  await expect(cards.getByRole('button')).toHaveCount(3);
  await expect(panel.getByTestId('command-history-filter-status')).toHaveCount(0);
  await expect(panel.getByTestId('command-history-filter-directory')).toBeVisible();
  await cards.getByRole('button', { name: '移除筛选：仅星标或已分组', exact: true }).click();
  await expect(page.getByTestId('command-history-tests')).toHaveCount(0);
  await expect(page.getByTestId('command-history-noise')).toBeVisible();
  await cards.getByRole('button', { name: '移除筛选：当前目录', exact: true }).click();
  await expect(cards.getByRole('button')).toHaveCount(1);
  await expect(page.getByTestId('command-history-tests')).toBeVisible();
  await cards.getByRole('button', { name: '移除筛选：仅相同环境', exact: true }).click();
  await expect(cards).toHaveCount(0);
});

test('creates groups at the front from ungrouped command menus and page actions across reloads', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem(`mock-command-history-preferences:${JSON.stringify(['local', '/home/e2e/project'])}`, JSON.stringify({
    favorites: [], hidden: [], rules: [], groups: [{ id: 'existing', name: 'Existing', commandKeys: [] }], groupOrder: ['history', 'existing', 'favorites'],
  })));
  await page.reload();
  const panel = page.getByTestId('command-history-panel');
  const writes = await page.evaluate(() => (window as unknown as { __PTY_WRITES__: string[] }).__PTY_WRITES__.length);
  await page.getByTestId('command-history-build').click({ button: 'right' });
  await expect(page.getByRole('button', { name: '新建命令分组', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('ungrouped-new-group-menu.png') });
  await page.getByRole('button', { name: '新建命令分组', exact: true }).click();
  const firstGroupName = page.getByRole('textbox', { name: '重命名命令分组', exact: true });
  await expect(firstGroupName).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('group-rename-inline.png') });
  await page.setViewportSize({ width: 680, height: 800 });
  await page.screenshot({ path: test.info().outputPath('group-rename-inline-narrow.png') });
  await page.setViewportSize({ width: 1240, height: 800 });
  await firstGroupName.fill('Build tools');
  await firstGroupName.press('Enter');
  const groups = panel.locator('.command-history-group');
  await expect(groups.first().getByRole('button', { name: 'Build tools', exact: true })).toBeVisible();
  await expect(groups.first().getByTestId('command-history-build')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('new-group-first.png') });
  await page.getByTestId('command-history-build').click({ button: 'right' });
  await expect(page.getByRole('button', { name: '新建命令分组', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await panel.getByRole('button', { name: '历史命令操作', exact: true }).click();
  await page.getByRole('button', { name: '新建命令分组', exact: true }).click();
  const secondGroupName = page.getByRole('textbox', { name: '重命名命令分组', exact: true });
  await secondGroupName.fill('Latest group');
  await secondGroupName.press('Enter');
  await expect(groups.first().getByRole('button', { name: 'Latest group', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __PTY_WRITES__: string[] }).__PTY_WRITES__.length)).toBe(writes);
  await page.reload();
  await expect(groups.first().getByRole('button', { name: 'Latest group', exact: true })).toBeVisible();
  await expect(groups.nth(1).getByTestId('command-history-build')).toBeVisible();
  await expect(groups.nth(2)).toHaveAttribute('data-testid', 'command-group-existing');
  await expect(groups.nth(3)).toHaveAttribute('data-testid', 'command-group-history');
});

test('matches drag slot height, hides child controls, keeps ungrouped commands fixed and remembers collapsed details', async ({ page }) => {
  const panel = page.getByTestId('command-history-panel');
  await page.getByTestId('command-history-build').hover();
  await page.getByTestId('command-history-build').getByRole('button', { name: '命令操作' }).click();
  await page.getByRole('button', { name: '保存到收藏', exact: true }).click();
  const favorites = page.getByTestId('command-group-favorites');
  const history = page.getByTestId('command-group-history');
  const row = favorites.locator('[data-command-history]');
  await row.click(); const sourceHeight = (await row.boundingBox())!.height;
  const start = (await row.boundingBox())!; const target = (await history.locator('.command-history-section').boundingBox())!;
  await page.mouse.move(start.x + 40, start.y + start.height / 2); await page.mouse.down();
  await page.mouse.move(target.x + 40, target.y + 5, { steps: 8 });
  const slot = panel.locator('[data-reorder-placeholder]');
  await expect(slot).toHaveCount(1);
  expect(Math.abs((await slot.boundingBox())!.height - sourceHeight)).toBeLessThan(1);
  for (const button of await row.getByRole('button', { includeHidden: true }).all()) await expect(button).toBeHidden();
  await expect(page.locator('[role="tooltip"]')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('command-drag-height.png') });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await row.click();
  await dragTo(page, favorites.getByRole('button', { name: '收起星标命令', exact: true }), history.locator('.command-history-section'), true);
  await expect(panel.locator('.command-history-group').last()).toHaveAttribute('data-testid', 'command-group-history');
  await expect(history.locator('[data-reorder-item="history"]')).toHaveCount(0);
  await history.getByRole('button', { name: '未分组命令', exact: true }).click();
  await expect(page.getByTestId('command-history-tests')).toBeHidden();
  await page.screenshot({ path: test.info().outputPath('ungrouped-collapsed.png') });
  await history.getByRole('button', { name: '未分组命令', exact: true }).click();
  await page.reload();
  await expect(panel.locator('.command-history-group').last()).toHaveAttribute('data-testid', 'command-group-history');
  await page.getByTestId('command-history-tests').click();
  const handle = (await page.getByTestId('resize-command-details').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 4); await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, 790, { steps: 12 }); await page.mouse.up();
  const details = panel.getByRole('region', { name: '命令详情' });
  await expect(details).toHaveAttribute('data-collapsed', 'true');
  await page.screenshot({ path: test.info().outputPath('details-collapsed.png') });
  await page.reload(); await page.getByTestId('command-history-tests').click();
  await expect(details).toHaveAttribute('data-collapsed', 'true');
  await details.getByRole('button', { name: '命令详情', exact: true }).click();
  await expect(details).toHaveAttribute('data-collapsed', 'false');
  await panel.getByRole('button', { name: '历史命令操作', exact: true }).click();
  await page.getByRole('button', { name: '历史命令设置', exact: true }).click();
  await page.getByRole('combobox', { name: '命令执行目标' }).click();
  await page.getByRole('option', { name: '当前终端', exact: true }).click();
  await page.getByRole('combobox', { name: '双击命令' }).click();
  await page.getByRole('option', { name: '运行命令', exact: true }).click();
  await page.screenshot({ path: test.info().outputPath('command-history-settings.png') });
  await page.setViewportSize({ width: 680, height: 640 });
  await page.screenshot({ path: test.info().outputPath('command-history-settings-narrow.png') });
  await page.setViewportSize({ width: 1240, height: 800 });
  await page.evaluate(async () => { const { useWorkspaceStore } = await import('/src/features/workspace/stores/workspace.ts'); const store = useWorkspaceStore.getState(); store.activate(store.tabs.find(tab => tab.kind === 'session')!.id); });
  const writes = await page.evaluate(() => (window as unknown as { __PTY_WRITES__: string[] }).__PTY_WRITES__.length);
  await panel.locator('[data-command-history]').filter({ hasText: 'npm run build' }).dblclick();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __PTY_WRITES__: string[] }).__PTY_WRITES__.length)).toBeGreaterThan(writes);
});

test('previews and applies AI grouping in command history and session tabs without executing commands', async ({ page }) => {
  const panel = page.getByTestId('command-history-panel');
  const writes = await page.evaluate(() => (window as unknown as { __PTY_WRITES__: string[] }).__PTY_WRITES__.length);
  await page.evaluate(() => { (window as unknown as { __AI_REPLY__: string }).__AI_REPLY__ = JSON.stringify({ groups: [{ name: 'Build and test', itemIds: ['build', 'tests'] }, { name: 'Utilities', itemIds: ['noise'] }] }); });
  await page.getByTestId('command-history-build').click({ button: 'right' });
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'AI 自动分组', exact: true }).click();
  const tool = await popup;
  await tool.waitForLoadState();
  await tool.evaluate(() => { (window as unknown as { __AI_REPLY__: string }).__AI_REPLY__ = JSON.stringify({ groups: [{ name: 'Build and test', itemIds: ['i1', 'i2'] }, { name: 'Utilities', itemIds: ['i3'] }] }); });
  let dialog = tool.getByRole('dialog', { name: 'AI 自动分组', exact: true });
  await dialog.getByRole('button', { name: '生成分组建议' }).click();
  await expect(dialog.getByRole('heading', { name: 'Build and test 2' })).toBeVisible();
  await tool.screenshot({ path: test.info().outputPath('command-ai-group-preview.png') });
  await expect(panel.getByRole('button', { name: 'Build and test', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: '应用分组' }).click();
  await expect(panel.getByRole('button', { name: 'Build and test', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('command-ai-groups.png') });
  expect(await page.evaluate(() => (window as unknown as { __PTY_WRITES__: string[] }).__PTY_WRITES__.length)).toBe(writes);
  await ensureTabsOpen(page);
  const ids = await page.evaluate(async () => { const { useWorkspaceStore } = await import('/src/features/workspace/stores/workspace.ts'); const store = useWorkspaceStore.getState(); store.addTab({ title: 'Deploy' }); store.addTab({ title: 'Logs' }); return useWorkspaceStore.getState().tabs.filter(tab => tab.kind === 'session').map(tab => tab.id); });
  // Reload assertions need saved session fixtures; untouched draft tabs intentionally do not restore.
  await page.evaluate(async ids => {
    const path = '/src/features/workspace/services/sessionManager.ts';
    const { ensureContentSession } = await import(path) as typeof import('../src/features/workspace/services/sessionManager');
    await Promise.all(ids.map(id => ensureContentSession(id)));
  }, ids);
  await page.evaluate(ids => { (window as unknown as { __AI_REPLY__: string }).__AI_REPLY__ = JSON.stringify({ groups: [{ name: 'Operations', itemIds: ids.slice(0, 2) }, { name: 'Monitoring', itemIds: ids.slice(2) }] }); }, ids);
  await page.getByTestId(`tab-row-${ids[0]}`).click({ button: 'right' });
  const tabPopup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'AI 自动分组', exact: true }).click();
  const tabTool = await tabPopup;
  await tabTool.waitForLoadState();
  await tabTool.evaluate(count => { (window as unknown as { __AI_REPLY__: string }).__AI_REPLY__ = JSON.stringify({ groups: [{ name: 'Operations', itemIds: ['i1', 'i2'] }, { name: 'Monitoring', itemIds: Array.from({ length: count - 2 }, (_, i) => `i${i + 3}`) }] }); }, ids.length);
  dialog = tabTool.getByRole('dialog', { name: 'AI 自动分组', exact: true });
  await dialog.getByRole('button', { name: '生成分组建议' }).click();
  await expect(dialog.getByRole('heading', { name: 'Operations 2' })).toBeVisible();
  await tabTool.screenshot({ path: test.info().outputPath('tabs-ai-group-preview.png') });
  await dialog.getByRole('button', { name: '应用分组' }).click();
  await expect(page.locator('[data-group-id]')).toHaveCount(2);
  await page.screenshot({ path: test.info().outputPath('tabs-ai-groups.png') });
  await page.reload(); await ensureTabsOpen(page);
  await expect(page.locator('[data-group-id]')).toHaveCount(2);
});

test('retains an independent tool through drag, minimize, restore and pin changes, then closes and recreates it', async ({ page }) => {
  test.setTimeout(60_000);
  const panel = page.getByTestId('command-history-panel');
  const popup = page.waitForEvent('popup');
  await panel.getByRole('button', { name: '让 AI 编写', exact: true }).click();
  const tool = await popup;
  const dialog = tool.getByRole('dialog', { name: '让 AI 编写', exact: true });
  await expect(dialog).toHaveAttribute('data-pinned', 'false');
  await expect(dialog).toHaveAttribute('aria-modal', 'false');
  await tool.setViewportSize({ width: 368, height: 488 });
  const controls = tool.getByTestId('tool-window-controls');
  const bounds = (await controls.boundingBox())!;
  expect(bounds.y).toBe(0); expect(bounds.x + bounds.width).toBe(368);
  for (const button of await controls.getByRole('button').all()) expect((await button.boundingBox())!.height).toBe(bounds.height);
  const request = await page.evaluate(() => (window as unknown as { __WINDOW_OPS__: { command: string; value: Record<string, unknown> }[] }).__WINDOW_OPS__.find(op => op.command === 'plugin:webview|create_webview_window')!.value);
  expect(request.skipTaskbar).toBe(false); expect(request.alwaysOnTop).toBe(false); expect(request.parent).toBeUndefined();
  expect(request.width).toBe(368); expect(request.height).toBe(488);
  expect(request.minWidth).toBeGreaterThanOrEqual(340); expect(request.minHeight).toBeGreaterThanOrEqual(280);
  expect(await tool.evaluate(() => (window as unknown as { __PTY_SPAWNS__: unknown[] }).__PTY_SPAWNS__.length)).toBe(0);
  const prompt = dialog.getByRole('textbox', { name: '描述命令需求' });
  await prompt.fill('Keep my draft after minimizing');
  const original = (await dialog.boundingBox())!;
  await tool.getByTestId('tool-window-heading').dispatchEvent('mousedown', { button: 0 });
  await expect.poll(() => tool.evaluate(() => (window as unknown as { __WINDOW_OPS__: { command: string }[] }).__WINDOW_OPS__.filter(op => op.command === 'plugin:window|start_dragging').length)).toBe(1);
  expect((await dialog.boundingBox())!.height).toBe(original.height);
  await expect(prompt).toHaveValue('Keep my draft after minimizing');
  const countMinimizes = () => tool.evaluate(() => (window as unknown as { __WINDOW_OPS__: { command: string }[] }).__WINDOW_OPS__.filter(op => op.command === 'plugin:window|minimize').length);
  await tool.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect.poll(countMinimizes).toBeGreaterThan(0);
  const beforeRestore = await countMinimizes();
  await tool.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
  await tool.waitForTimeout(350);
  expect(await countMinimizes()).toBe(beforeRestore);
  await expect(prompt).toHaveValue('Keep my draft after minimizing');
  await tool.screenshot({ path: test.info().outputPath('native-command-after-drag.png') });
  const before = page.context().pages().length;
  await panel.getByRole('button', { name: '让 AI 编写', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __WINDOW_OPS__: { command: string }[] }).__WINDOW_OPS__.filter(op => op.command === 'plugin:window|unminimize').length)).toBe(1);
  expect(page.context().pages()).toHaveLength(before);
  await expect(prompt).toHaveValue('Keep my draft after minimizing');
  await dialog.getByRole('button', { name: '固定窗口', exact: true }).click();
  await expect(dialog).toHaveAttribute('data-pinned', 'true');
  await tool.mouse.move(0, 0);
  await dialog.getByRole('textbox', { name: '描述命令需求' }).focus();
  await expect(dialog.getByRole('button', { name: '取消固定窗口', exact: true })).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const minimized = await tool.evaluate(() => (window as unknown as { __WINDOW_OPS__: { command: string }[] }).__WINDOW_OPS__.filter(op => op.command === 'plugin:window|minimize').length);
  await tool.evaluate(() => window.dispatchEvent(new Event('blur')));
  expect(await tool.evaluate(() => (window as unknown as { __WINDOW_OPS__: { command: string }[] }).__WINDOW_OPS__.filter(op => op.command === 'plugin:window|minimize').length)).toBe(minimized);
  await page.locator('[data-terminal-input]').first().fill('git status');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '取消固定窗口', exact: true }).click();
  await expect(dialog).toHaveAttribute('data-pinned', 'false');
  await tool.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect.poll(() => tool.evaluate(() => (window as unknown as { __WINDOW_OPS__: { command: string }[] }).__WINDOW_OPS__.filter(op => op.command === 'plugin:window|minimize').length)).toBeGreaterThan(minimized);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect.poll(() => tool.isClosed()).toBe(true);
  const reopened = page.waitForEvent('popup');
  await panel.getByRole('button', { name: '让 AI 编写', exact: true }).click();
  const fresh = await reopened;
  await expect(fresh.getByRole('textbox', { name: '描述命令需求' })).toHaveValue('');
  await expect(fresh.getByRole('dialog')).toHaveAttribute('data-pinned', 'false');
  await page.getByTestId('window-close').click();
  await expect.poll(() => fresh.isClosed()).toBe(true);
});

test('keeps native AI window actions visible in small layouts and reports malformed grouping without mutating history', async ({ page }) => {
  await page.getByTestId('command-history-build').click({ button: 'right' });
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'AI 自动分组', exact: true }).click();
  const tool = await popup;
  const dialog = tool.getByRole('dialog', { name: 'AI 自动分组', exact: true });
  await expect(dialog).toBeVisible();
  await tool.evaluate(() => { (window as unknown as { __AI_REPLY__: string }).__AI_REPLY__ = '{"groups":['; });
  await dialog.getByRole('button', { name: '生成分组建议' }).click();
  await expect(tool.getByRole('alert').getByText('自动重试后模型仍未返回有效结果，请重试或更换模型。', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '应用分组' })).toBeDisabled();
  expect(await tool.evaluate(() => (window as unknown as { __SEARCH_CALLS__: { cmd: string }[] }).__SEARCH_CALLS__?.filter(call => call.cmd === 'llm_stream').length)).toBe(2);
  await expect(page.getByTestId('command-history-build')).toBeVisible();
  await tool.setViewportSize({ width: 340, height: 280 });
  for (const theme of ['dark', 'light'] as const) {
    await tool.evaluate(async theme => { const { applyTheme } = await import('/src/config/theme/tokens.ts'); applyTheme(theme); }, theme);
    const footer = dialog.locator('footer');
    await expect(footer.getByRole('button', { name: '应用分组' })).toBeVisible();
    expect((await footer.boundingBox())!.y + (await footer.boundingBox())!.height).toBeLessThanOrEqual(280);
    await tool.screenshot({ path: test.info().outputPath(`native-group-small-${theme}.png`) });
  }
  await tool.getByRole('button', { name: '关闭错误提示', exact: true }).click();
  await tool.evaluate(() => { (window as unknown as { __AI_REPLY__: string }).__AI_REPLY__ = 'Here is the plan:\n```json\n{"groups":[{"name":"Build tools","itemIds":["i1"]}]}\n```'; });
  await dialog.getByRole('button', { name: '生成分组建议' }).click();
  await expect(dialog.getByRole('heading', { name: 'Build tools 1' })).toBeVisible();
  await tool.setViewportSize({ width: 480, height: 620 });
  await tool.screenshot({ path: test.info().outputPath('native-group-preview.png') });
  await dialog.getByRole('button', { name: '应用分组' }).click();
  await expect.poll(() => tool.isClosed()).toBe(true);
  await expect(page.getByTestId('command-history-panel').getByRole('button', { name: 'Build tools', exact: true })).toBeVisible();
});

test('continues generation while minimized and aborts a pending request before explicit window destruction', async ({ page }) => {
  const panel = page.getByTestId('command-history-panel');
  const popup = page.waitForEvent('popup');
  await panel.getByRole('button', { name: '让 AI 编写', exact: true }).click();
  const tool = await popup;
  const dialog = tool.getByRole('dialog', { name: '让 AI 编写', exact: true });
  await expect(dialog).toBeVisible();
  await tool.evaluate(() => {
    const state = window as unknown as { __AI_REPLY__: string; __AI_CHUNK_DELAY_MS__: number };
    state.__AI_REPLY__ = JSON.stringify({ command: 'npm run preview', cwd: '/home/e2e/project', explanation: 'Preview build output.' }); state.__AI_CHUNK_DELAY_MS__ = 300;
  });
  await dialog.getByRole('textbox', { name: '描述命令需求' }).fill('Preview build output');
  await dialog.getByRole('button', { name: '生成命令', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('正在编写');
  await tool.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.locator('[data-terminal-input]').first().fill('Keep working');
  await expect(dialog.getByRole('textbox', { name: '命令草稿' })).toHaveValue('npm run preview');
  expect(await tool.evaluate(() => (window as unknown as { __LLM_ABORTED__?: Set<string> }).__LLM_ABORTED__?.size ?? 0)).toBe(0);
  await tool.setViewportSize({ width: 360, height: 320 });
  await tool.screenshot({ path: test.info().outputPath('native-command-complete-small.png') });
  await dialog.getByRole('textbox', { name: '描述命令需求' }).fill('Revise this draft');
  await tool.evaluate(() => { (window as unknown as { __AI_CHUNK_DELAY_MS__: number }).__AI_CHUNK_DELAY_MS__ = 3000; });
  await dialog.getByRole('button', { name: '修改命令', exact: true }).click();
  await expect(dialog.getByRole('status')).toBeVisible();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect.poll(() => tool.isClosed()).toBe(true);
  await expect(page.locator('[data-terminal-input]').first()).toHaveValue('Keep working');
  expect(await page.evaluate(() => (window as unknown as { __WINDOW_OPS__: { command: string; value?: { aborted: number } }[] }).__WINDOW_OPS__.filter(op => op.command === 'received:tauri://destroyed').at(-1)?.value?.aborted)).toBeGreaterThan(0);
});
