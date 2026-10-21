import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

test('prefix cards replace the scope picker and persist on recent searches', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await page.getByTestId('global-search-trigger').click();
  const dialog = page.getByRole('dialog', { name: '全局搜索' });
  const input = dialog.getByRole('textbox', { name: '搜索工作区' });
  await input.fill('> 打开设置');
  await expect(dialog.getByTestId('search-scope-chip')).toContainText('快捷操作');
  await expect(input).toHaveValue('打开设置');
  await expect(dialog.getByTestId('search-filter-button')).toHaveCount(0);
  await expect(dialog.locator('[data-search-result] .key-hint [data-key-icon="Meta"]')).toBeVisible();
  expect(await dialog.locator('.global-search-header').evaluate(el => getComputedStyle(el).boxShadow)).toBe('none');
  await dialog.screenshot({ path: test.info().outputPath('scope-card.png') });
  await dialog.locator('[data-search-result]').first().click();
  await expect(dialog).toBeHidden();
  await page.getByTestId('global-search-trigger').click();
  const history = dialog.locator('.global-search-history').filter({ hasText: '打开设置' });
  await expect(history.getByTestId('history-scope-chip')).toContainText('快捷操作');
  await history.click();
  await expect(input).toHaveValue('打开设置');
  await dialog.getByRole('button', { name: '清除搜索范围' }).click();
  await expect(input).toHaveValue('打开设置');
  await expect(dialog.getByTestId('search-filter-button')).toBeVisible();
});

test('default terminal applies to new tabs and survives reload', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await gotoSetting(page, '打开方式');
  await page.getByRole('combobox', { name: '默认终端', exact: true }).click();
  await page.getByRole('option', { name: 'Bash', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('vrykell-terminal-defaults') ?? '{}').state?.shell)).toBe('bash');
  await page.screenshot({ path: test.info().outputPath('default-terminal.png') });
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.keyboard.press('Meta+t');
  await expect.poll(() => page.evaluate(async () => {
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    const state = useWorkspaceStore.getState();
    const tab = state.tabs.find(tab => tab.id === state.activeId);
    return tab?.kind === 'session' && tab.layout.type === 'leaf' ? tab.layout.terminal.shellType : '';
  })).toBe('bash');
  await expect(page.locator('[data-tab-row-id] [data-shell-mark="bash"]').first()).toHaveCSS('width', '16px');
  await page.reload();
  await page.keyboard.press('Meta+t');
  await expect(page.getByPlaceholder(/输入命令/).last()).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('vrykell-terminal-defaults')!).state.shell)).toBe('bash');
});

test('nearby content edges preview and open the dragged panel on release', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  const source = (await page.locator('[data-dock-btn="files"]').boundingBox())!;
  const body = (await page.locator('.workspace-body').boundingBox())!;
  const y = body.y + body.height / 2;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(body.x + 100, y, { steps: 5 });
  const preview = page.getByTestId('panel-drop-preview');
  await expect(preview).toHaveCount(0);
  await page.mouse.move(body.x + body.width / 2, y, { steps: 3 });
  await expect(preview).toHaveCount(0);
  await page.mouse.move(body.x + body.width - 70, y, { steps: 5 });
  await expect(preview).toHaveAttribute('data-side', 'right');
  await page.screenshot({ path: test.info().outputPath('drop-preview.png') });
  await page.mouse.up();
  await expect(preview).toHaveCount(0);
  await expect(page.locator('.workspace-side-panel[data-side="right"]').getByText('notes.txt')).toBeVisible();
});

test('deleted SSH profiles recover without a connecting trap and classic history omits command counts', async ({ page }) => {
  await setupTauriMock(page);
  await page.addInitScript(() => {
    const target = window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args: Record<string, unknown>) => Promise<unknown> } };
    const original = target.__TAURI_INTERNALS__.invoke;
    const session = { id: 'deleted-profile-history', title: 'Deleted SSH profile', status: 'historical', created_at: Date.now(), closed_at: Date.now(), block_count: 9, cwd: '', group_id: null, sort_order: 1, kind: 'session', payload: JSON.stringify({ layout: { type: 'leaf', terminal: { id: 'deleted-pane', kind: 'ssh', openMode: 'classic', ssh: { connectionId: 'gone', name: 'Saved SSH', host: 'saved.example.com', user: 'dev' } } } }) };
    target.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
      if (cmd === 'list_sessions') return [...await original(cmd, args) as unknown[], session];
      if (cmd === 'get_session' && args.id === session.id) return session;
      return original(cmd, args);
    };
  });
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await page.getByTestId('tab-history-btn').click();
  const row = page.getByText('Deleted SSH profile', { exact: true }).locator('xpath=..');
  await expect(row).toContainText('dev@saved.example.com');
  await expect(row).not.toContainText('命令块');
  await row.click();
  const recovery = page.getByTestId('ssh-session-recovery');
  await expect(recovery).toContainText('原 SSH 连接已被删除');
  await expect(page.getByTestId('ssh-connecting')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('ssh-profile-recovery.png') });
  await recovery.getByRole('button', { name: '使用此连接' }).click();
  await expect(recovery).toHaveCount(0);
  await expect(page.getByTestId('ssh-connection-input')).toBeVisible();
});


test('command menus use semantic groups and historical output shares the terminal background', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  const input = page.getByPlaceholder(/输入命令/);
  await input.fill('ls'); await input.press('Enter');
  const block = page.locator('[data-testid^="command-block-"]').first();
  await expect(block.getByTestId('exit-code')).toBeVisible();
  const colors = await block.evaluate(element => {
    const output = [...element.querySelectorAll<HTMLElement>('[data-selectable]')].at(-1)!;
    const pane = element.closest<HTMLElement>('.terminal-pane')!;
    // A transparent surface serializes as either rgba(…, 0) or color(srgb … / 0).
    const alpha = (color: string) => {
      const slash = color.match(/\/\s*([\d.]+)\s*\)/);
      if (slash) return Number(slash[1]);
      const parts = color.match(/rgba?\(([^)]+)\)/);
      if (!parts) return color === 'transparent' ? 0 : 1;
      const values = parts[1].split(',').map(part => part.trim());
      return values.length > 3 ? Number(values[3]) : 1;
    };
    let surface: HTMLElement | null = output;
    while (surface && alpha(getComputedStyle(surface).backgroundColor) === 0) surface = surface.parentElement;
    return [surface ? getComputedStyle(surface).backgroundColor : '', getComputedStyle(pane).backgroundColor];
  });
  expect(colors[0]).toBe(colors[1]);
  await block.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: '命令块操作' });
  await expect(menu).toBeVisible();
  expect(await menu.getByRole('menuitem').allTextContents()).toEqual(['重新运行', '发给 AI 分析', '复制命令', '复制输出', '清除所有块']);
  await expect(menu.getByRole('separator')).toHaveCount(2);
  await menu.screenshot({ path: test.info().outputPath('command-menu.png') });
});
