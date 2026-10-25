import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { pickPlacementZone } from './placement';

for (const theme of ['dark', 'light']) test(`common start scopes creation correctly in ${theme} and retains its workspace`, async ({ page }, info) => {
  await setupTauriMock(page, { schedulesSeed: [] });
  await page.addInitScript(theme => { localStorage.setItem('vrykell-theme-mode', theme); localStorage.setItem('vrykell-startup-mode', 'empty'); }, theme);
  await page.goto('/');
  await page.getByTestId('workspace-area-unified').click();
  const workspace = page.getByTestId('unified-workspace');
  const start = workspace.getByTestId('unified-start-page');
  for (const width of [1240, 760]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(start.getByRole('button', { name: '连接服务器', exact: true })).toBeVisible();
    await expect(start.getByRole('button', { name: '新建文件', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`common-start-${theme}-${width}.png`) });
  }
  await page.setViewportSize({ width: 1240, height: 800 });
  await start.getByRole('button', { name: '连接服务器', exact: true }).click();
  const serverPicker = page.getByRole('dialog', { name: '连接服务器', exact: true });
  await expect(serverPicker.getByTestId('new-tab-option-ssh:ssh-1')).toBeVisible();
  await expect(serverPicker.locator('[data-testid^="new-tab-option-shell:"]')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'ACP', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await start.getByRole('button', { name: '新终端', exact: true }).click();
  const profiles = page.getByRole('dialog', { name: '新建标签页', exact: true });
  await expect(profiles.getByTestId('new-tab-option-shell:bash')).toBeVisible();
  await expect(profiles.locator('[data-testid^="new-tab-option-ssh:"]')).toHaveCount(0);
  await profiles.getByTestId('new-tab-option-shell:bash').click();
  await expect(workspace.locator('.terminal-pane')).toBeVisible();
  await expect(workspace).toBeVisible();
  await expect(page.getByTestId('workspace-instance-bar').getByRole('tab').filter({ hasText: '开始' })).toHaveCount(0);
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: '新建工作区标签', exact: true }).click();
  await page.getByRole('menuitem', { name: '新建文件', exact: true }).click();
  await expect(workspace.locator('.monaco-editor')).toBeVisible();
  await expect(workspace).toBeVisible();
});

test('filters a mixed history item by each member and restores the complete layout in place', async ({ page }, info) => {
  await setupTauriMock(page, { schedulesSeed: [] });
  await page.goto('/'); await page.getByTestId('workspace-area-unified').click();
  const workspace = page.getByTestId('unified-workspace'); const bar = page.getByTestId('workspace-instance-bar');
  const terminalTitle = await bar.getByRole('tab').nth(0).innerText();
  await bar.getByRole('button', { name: '新建工作区标签', exact: true }).click();
  await page.getByRole('menuitem', { name: '新对话', exact: true }).click();
  await workspace.locator('[data-chat-composer]').fill('preserved composition draft');
  const terminal = await page.locator('.terminal-pane').first().elementHandle();
  await bar.getByRole('button', { name: '拆分标签页', exact: true }).click();
  await page.getByRole('menuitem', { name: terminalTitle, exact: true }).click();
  await pickPlacementZone(page, workspace.locator('.unified-pane').first(), 'right');
  await expect(workspace.locator('.unified-pane')).toHaveCount(2);
  const spawns = await page.evaluate(() => (window as unknown as { __PTY_SPAWNS__: unknown[] }).__PTY_SPAWNS__.length);
  await bar.getByRole('button', { name: '全部历史', exact: true }).click();
  const history = page.getByTestId('unified-history-page');
  const row = history.locator('[data-history-kind="workspace"]');
  await expect(row).toHaveCount(1); await expect(row).toContainText('2 个窗格');
  await row.getByRole('button', { name: '展开窗格' }).click();
  await expect(history.getByRole('group', { name: '工作区窗格' })).toBeVisible();
  await expect(row.locator('[data-icon-count="2"]')).toBeVisible();
  await expect(row.locator('.history-row-icon [data-app-mark]')).toBeVisible();
  await expect(history.getByRole('group', { name: '工作区窗格' }).locator('[data-shell-mark]')).toBeVisible();
  for (const type of ['终端历史', 'AI 对话']) {
    await history.getByTestId('unified-history-filter').click();
    await page.getByTestId('unified-history-filter-menu').getByRole('button', { name: type, exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(row).toHaveCount(1);
  }
  await history.getByTestId('unified-history-filter').click();
  await page.getByTestId('unified-history-filter-menu').getByRole('button', { name: '分屏布局', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(row).toHaveCount(1);
  await page.screenshot({ path: info.outputPath('mixed-history-expanded.png') });
  await row.click();
  await expect(workspace).toBeVisible(); await expect(workspace.locator('.unified-pane')).toHaveCount(2);
  await expect(workspace.locator('[data-chat-composer]')).toHaveValue('preserved composition draft');
  expect(await terminal!.evaluate(element => element.isConnected && !!element.closest('[data-testid="unified-workspace"]'))).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __PTY_SPAWNS__: unknown[] }).__PTY_SPAWNS__.length)).toBe(spawns);
});

test('only offers pane removal for a real split and keeps the remaining terminal alive', async ({ page }) => {
  await setupTauriMock(page, { schedulesSeed: [] }); await page.goto('/');
  await page.getByTestId('workspace-area-unified').click();
  const workspace = page.getByTestId('unified-workspace'); const bar = page.getByTestId('workspace-instance-bar');
  await bar.getByRole('tab').nth(0).click();
  const pane = workspace.locator('.terminal-pane').first();
  await pane.click({ button: 'right', position: { x: 90, y: 90 } });
  await expect(page.getByRole('button', { name: '移除此分屏', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await bar.getByRole('button', { name: '新建工作区标签', exact: true }).click();
  await page.getByRole('menuitem', { name: '新建文件', exact: true }).click();
  const title = await bar.getByRole('tab').nth(0).innerText();
  await bar.getByRole('button', { name: '拆分标签页', exact: true }).click();
  await page.getByRole('menuitem', { name: title, exact: true }).click();
  await pickPlacementZone(page, workspace.locator('.unified-pane').first(), 'right');
  await expect(workspace.locator('.unified-pane')).toHaveCount(2);
  await pane.click({ button: 'right', position: { x: 90, y: 90 } });
  await page.getByRole('menu', { name: '操作菜单', exact: true }).getByRole('button', { name: '移除此分屏', exact: true }).click();
  await expect(workspace.locator('.unified-pane')).toHaveCount(1);
  await expect(pane).toHaveCount(0);
  await workspace.locator('.unified-pane').click({ button: 'right', position: { x: 90, y: 90 } });
  await expect(page.getByRole('button', { name: '移除此分屏', exact: true })).toHaveCount(0);
});

for (const theme of ['dark', 'light']) test(`opens the existing agent launcher after closing both split menu levels in ${theme}`, async ({ page }, info) => {
  await setupTauriMock(page, { schedulesSeed: [] });
  await page.addInitScript(theme => localStorage.setItem('vrykell-theme-mode', theme), theme);
  await page.goto('/'); await page.getByTestId('workspace-area-unified').click();
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: '新建工作区标签', exact: true }).click();
  await page.getByRole('menuitem', { name: '新建文件', exact: true }).click();
  const bar = page.getByTestId('workspace-instance-bar');
  for (const width of [640, 1240]) {
    await page.setViewportSize({ width, height: 800 });
    const split = bar.getByRole('button', { name: '拆分标签页', exact: true });
    await split.click();
    await page.getByRole('menuitem', { name: '新建工作区标签', exact: true }).click();
    await page.getByRole('menuitem', { name: 'ACP 智能体', exact: true }).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
    const picker = page.getByRole('dialog', { name: 'ACP', exact: true });
    await expect(picker.getByTestId('acp-launcher-directory')).toBeVisible();
    const directory = (await picker.getByTestId('acp-launcher-directory').boundingBox())!;
    const browse = (await picker.getByRole('button', { name: '选择项目文件夹', exact: true }).boundingBox())!;
    expect(Math.abs(directory.height - browse.height)).toBeLessThan(1);
    expect(Math.abs(directory.y - browse.y)).toBeLessThan(1);
    const search = (await picker.locator('.acp-profile-search').boundingBox())!;
    expect(Math.abs(directory.x - search.x)).toBeLessThan(1);
    expect(Math.abs(browse.x + browse.width - search.x - search.width)).toBeLessThan(1);
    await expect(picker.getByTestId('acp-launcher-search')).toBeVisible();
    const bounds = await picker.boundingBox(); const trigger = await split.boundingBox();
    expect(bounds!.height).toBeGreaterThan(120);
    expect(Math.abs(bounds!.y - trigger!.y - trigger!.height - 4)).toBeLessThan(2);
    expect(bounds!.x).toBeGreaterThanOrEqual(7); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width - 7);
    await page.screenshot({ path: info.outputPath(`acp-picker-${theme}-${width}.png`) });
    await page.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);
    await expect(page.getByTestId('placement-overlay')).toHaveCount(0);
  }
});

for (const width of [640, 1240]) test(`keeps toolbar actions and creation pickers separate inside a ${width}px window`, async ({ page }, info) => {
  await setupTauriMock(page, { schedulesSeed: [] }); await page.goto('/');
  await page.getByTestId('workspace-area-unified').click();
  await page.setViewportSize({ width, height: 800 });
  const bar = page.getByTestId('workspace-instance-bar');
  for (const label of ['新终端', '连接服务器']) {
    await bar.getByRole('button', { name: '新建工作区标签', exact: true }).click();
    await page.getByRole('menuitem', { name: label, exact: true }).click();
    const picker = page.getByRole('dialog', { name: label === '新终端' ? '新建标签页' : label, exact: true });
    await expect(picker).toBeVisible();
    await expect(page.getByRole('menu', { name: '新建工作区标签', exact: true })).toHaveCount(0);
    const bounds = await picker.boundingBox();
    expect(bounds!.height).toBeGreaterThan(120); expect(bounds!.x).toBeGreaterThanOrEqual(7);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width - 7);
    expect(bounds!.y).toBeGreaterThanOrEqual(7); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(793);
    await page.screenshot({ path: info.outputPath(`picker-${label}-${width}.png`) });
    await page.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);
  }
  await bar.getByRole('button', { name: '新建工作区标签', exact: true }).click();
  await page.getByRole('menuitem', { name: '新建文件', exact: true }).click();
  await expect(page.getByTestId('unified-workspace').locator('.monaco-editor')).toBeVisible();
  const rectangles = await bar.locator('.folder-actions button:visible').evaluateAll(buttons => buttons.map(button => {
    const rect = button.getBoundingClientRect(); return { label: button.getAttribute('aria-label'), x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
  }));
  for (let index = 0; index < rectangles.length; index += 1) for (const other of rectangles.slice(index + 1)) {
    const current = rectangles[index]!;
    expect(current.right <= other.x + 0.5 || other.right <= current.x + 0.5 || current.bottom <= other.y + 0.5 || other.bottom <= current.y + 0.5, `${current.label} overlaps ${other.label}`).toBe(true);
  }
  await page.screenshot({ path: info.outputPath(`toolbar-${width}.png`) });
});

test('restores single conversation history back into the common workspace from its start page', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('e2e-conversations', JSON.stringify([{ id: 'saved-chat', title: 'Saved work', created_at: 1, updated_at: 2, environment: '{}' }])));
  await setupTauriMock(page, { schedulesSeed: [] });
  await page.goto('/'); await page.getByTestId('workspace-area-unified').click();
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: '全部历史', exact: true }).click();
  await page.getByTestId('unified-history-conversation:saved-chat').click();
  const workspace = page.getByTestId('unified-workspace');
  await expect(workspace).toBeVisible();
  await expect(workspace.locator('[data-chat-composer]')).toBeVisible();
});

test('shows creation choices directly when a split has no existing tabs to add', async ({ page }) => {
  await setupTauriMock(page, { schedulesSeed: [] }); await page.goto('/');
  await page.getByTestId('workspace-area-unified').click();
  const bar = page.getByTestId('workspace-instance-bar');
  await bar.getByRole('tab').nth(0).click();
  await bar.getByRole('button', { name: '拆分标签页', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: '新建工作区标签', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: '新终端', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '新建文件', exact: true })).toBeVisible();
});
