import { expect, test, type Locator, type Page } from '@playwright/test';
import { fsOps, setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

async function centeredContents(button: Locator) {
  const centers = await button.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return Array.from(element.children).map(child => {
      const box = child.getBoundingClientRect();
      return Math.abs(box.y + box.height / 2 - bounds.y - bounds.height / 2);
    });
  });
  expect(Math.max(...centers)).toBeLessThan(2);
}

async function dragTo(page: Page, source: Locator, destination: Locator, after = false) {
  const from = (await source.boundingBox())!;
  await page.mouse.move(from.x + 28, from.y + from.height / 2); await page.mouse.down();
  await page.mouse.move(from.x + 38, from.y + from.height / 2 + 7, { steps: 3 });
  await expect(page.locator('[data-reorder-preview]')).toBeVisible();
  const to = (await destination.boundingBox())!;
  await page.mouse.move(to.x + 28, to.y + to.height * (after ? 0.9 : 0.1), { steps: 8 });
  await page.mouse.up();
}

for (const theme of ['dark', 'light'] as const) {
  test(`launch pages, selection and shared surfaces in ${theme}`, async ({ page }, info) => {
    await setupTauriMock(page, {});
    await page.addInitScript(theme => {
      localStorage.setItem('vrykell-theme-mode', theme);
      localStorage.setItem('vrykell-startup-mode', 'empty');
    }, theme);
    await page.goto('/');
    await page.evaluate(() => { document.documentElement.dataset.nativeMaterial = 'fallback'; });
    const start = page.getByTestId('start-page');
    await expect(start.getByTestId('terminal-start-profile-zsh')).toBeVisible();
    await centeredContents(start.getByTestId('terminal-start-new'));
    const terminal = page.getByTestId('workspace-area-terminal');
    const content = terminal.locator('.sidebar-row-content');
    const selection = await content.evaluate(element => getComputedStyle(element).backgroundColor);
    await page.getByTestId('workspace-area-code').hover();
    await expect(terminal).toHaveAttribute('aria-current', 'page');
    await expect(content).toHaveCSS('background-color', selection);
    expect(selection).toBe(theme === 'dark' ? 'rgb(72, 72, 72)' : 'rgb(255, 255, 255)');
    await expect(page.locator('.workspace-title > span')).toHaveText('终端会话');
    const search = start.getByRole('textbox', { name: '搜索 Shell 配置' });
    await expect(search).toHaveCSS('background-color', theme === 'dark' ? 'rgb(60, 60, 60)' : 'rgb(255, 255, 255)');
    await expect(start.locator('[data-shell-mark="zsh"]')).toHaveCSS('color', 'rgb(241, 90, 36)');
    await page.screenshot({ path: info.outputPath(`terminal-start-${theme}.png`), animations: 'disabled' });
    await page.setViewportSize({ width: 700, height: 800 });
    await centeredContents(start.getByTestId('terminal-start-new'));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(700);
    await page.screenshot({ path: info.outputPath(`terminal-start-narrow-${theme}.png`), animations: 'disabled' });
    await page.setViewportSize({ width: 1240, height: 800 });
    await page.getByTestId('workspace-sidebar-expand').click();
    await page.getByTestId('tab-new-btn').click();
    await expect(page.getByRole('dialog', { name: '新建标签页' })).toHaveCSS('background-color', theme === 'dark' ? 'rgb(48, 48, 48)' : 'rgb(250, 250, 250)');
    await page.keyboard.press('Escape');
    const more = page.locator('.folder-more-button').first();
    const menuButtonColor = theme === 'dark' ? 'rgb(32, 32, 32)' : 'rgb(230, 230, 230)';
    await more.hover(); await expect(more).toHaveCSS('background-color', menuButtonColor);
    await expect(more).toBeDisabled();
    await page.getByTestId('tab-search-toggle').click();
    await page.getByTestId('tab-search').fill('does-not-exist');
    const empty = page.getByText('无匹配会话', { exact: true });
    await expect(empty).toBeVisible();
    const emptyBox = (await empty.boundingBox())!;
    const strip = (await page.locator('.terminal-tab-list').boundingBox())!;
    expect(Math.abs(emptyBox.y + emptyBox.height / 2 - strip.y - strip.height / 2)).toBeLessThan(2);
    await page.getByTestId('tab-search-toggle').click();
    await page.getByTestId('workspace-area-ai').click();
    await expect(page.locator('.workspace-title > span')).toHaveText('智能对话');
    await centeredContents(page.getByTestId('ai-start-new-conversation'));
    await expect(page.locator('.launch-stats').getByText('今日请求')).toBeVisible();
    await expect(page.getByTestId('acp-launcher-Fake ACP')).toContainText('0 轮');
    await page.screenshot({ path: info.outputPath(`ai-start-${theme}.png`), animations: 'disabled' });
    await page.setViewportSize({ width: 700, height: 800 });
    await centeredContents(page.getByTestId('ai-start-new-conversation'));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(700);
    await page.screenshot({ path: info.outputPath(`ai-start-narrow-${theme}.png`), animations: 'disabled' });
    await page.setViewportSize({ width: 1240, height: 800 });
    await page.getByTestId('workspace-sidebar-expand').click();
    await gotoSetting(page, '字体与显示');
    const nav = page.getByRole('complementary', { name: '设置目录' });
    await nav.getByRole('button', { name: '模型配置', exact: true }).hover();
    await nav.locator('.settings-navigation-list').evaluate(element => { element.scrollTop = 0; });
    await expect(nav.getByRole('button', { name: '字体与显示', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('combobox', { name: '终端字号' })).toHaveCSS('background-color', theme === 'dark' ? 'rgb(60, 60, 60)' : 'rgb(255, 255, 255)');
  });

  test(`file rename uses the shared fixed-width field in ${theme}`, async ({ page }, info) => {
    await setupTauriMock(page, {});
    await page.addInitScript(theme => localStorage.setItem('vrykell-theme-mode', theme), theme);
    await page.goto('/'); await page.locator('[data-dock-btn="files"]').click();
    const row = page.getByTestId('local-file-tree').locator('[data-path="/home/e2e/notes.txt"]');
    await row.click({ button: 'right' }); await page.getByRole('button', { name: '重命名', exact: true }).click();
    const input = page.getByTestId('rename-input');
    await expect(input).toHaveClass(/text-input-field/);
    await expect(input).toHaveClass(/inline-rename-input/);
    await input.fill('test');
    const short = (await input.boundingBox())!;
    expect(short.width).toBeGreaterThan(120); expect(short.width).toBeLessThanOrEqual(176);
    await input.fill('中文文件名称.md');
    expect((await input.boundingBox())!.width).toBeCloseTo(short.width, 0);
    await input.fill('long-file-name'.repeat(40));
    expect((await input.boundingBox())!.width).toBeCloseTo(short.width, 0);
    expect((await input.boundingBox())!.width).toBeLessThan((await row.boundingBox())!.width);
    await page.setViewportSize({ width: 680, height: 640 });
    const narrow = (await input.boundingBox())!;
    const bounds = (await row.boundingBox())!;
    expect(narrow.x + narrow.width).toBeLessThan(bounds.x + bounds.width);
    await input.fill('test');
    await page.screenshot({ path: info.outputPath(`rename-${theme}.png`), animations: 'disabled' });
    await input.press('Escape'); await expect(input).toHaveCount(0);
    expect(await fsOps(page)).not.toContainEqual(expect.objectContaining({ op: 'rename' }));
    await row.click({ button: 'right' }); await page.getByRole('button', { name: '重命名', exact: true }).click();
    await input.fill('renamed.txt'); await input.press('Enter'); await page.getByTestId('confirm-ok').click();
    expect(await fsOps(page)).toContainEqual({ op: 'rename', path: '/home/e2e/notes.txt', newName: 'renamed.txt' });
  });
}

for (const layout of ['cards', 'table']) test(`hosts change fixed groups through their editor in ${layout}`, async ({ page }, info) => {
  await setupTauriMock(page, {});
  await page.addInitScript(layout => {
    localStorage.setItem('vrykell-host-library', JSON.stringify({ state: { hosts: { 'ssh-1': { group: 'Alpha', tags: ['production'], starred: true }, other: { group: 'Beta', tags: [], starred: false } } }, version: 0 }));
    localStorage.setItem('vrykell-host-view-v2', JSON.stringify({ layout }));
  }, layout);
  await page.goto('/'); await page.getByTestId('workspace-area-ssh').click();
  const row = page.getByTestId('ssh-row-ssh-1');
  if (layout === 'table') await expect(row).toHaveAttribute('data-reorder-item', 'ssh-1');
  else await expect(row).not.toHaveAttribute('data-reorder-item');
  await row.click({ button: 'right' });
  await page.getByRole('button', { name: '编辑连接', exact: true }).click();
  await page.getByRole('combobox', { name: '已有分组' }).click(); await page.getByRole('option', { name: 'Beta', exact: true }).click();
  await page.getByTestId('ssh-save-btn').click();
  await page.getByTestId('ssh-host-group-filter').click();
  const group = page.getByRole('menuitemcheckbox', { name: 'Beta', exact: true });
  await expect(group).toBeVisible(); await group.click();
  await expect(group).toHaveAttribute('aria-checked', 'true');
  await expect(group).not.toHaveAttribute('data-reorder-item'); await page.keyboard.press('Escape');
  await expect(row).toBeVisible();
  await expect(page.getByRole('dialog', { name: '主机详情' })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('vrykell-host-library')!).state.hosts['ssh-1'].group)).toBe('Beta');
  await page.screenshot({ path: info.outputPath(`host-groups-${layout}.png`), animations: 'disabled' });
  await page.reload(); await page.getByTestId('workspace-area-ssh').click();
  await expect(row).toBeVisible();
  await page.getByTestId('ssh-search').fill('no-matching-host');
  const empty = page.getByText('无匹配连接', { exact: true }); await expect(empty).toBeVisible();
  const emptyBox = (await empty.boundingBox())!;
  const results = (await page.locator(layout === 'cards' ? '.ssh-dashboard-grid' : '.ssh-host-list').boundingBox())!;
  expect(Math.abs(emptyBox.y + emptyBox.height / 2 - results.y - results.height / 2)).toBeLessThan(16);
});

test('dragging a singleton history tab retains its content and query', async ({ page }) => {
  await setupTauriMock(page, {});
  await page.goto('/'); await page.getByTestId('tab-history-btn').click();
  const history = page.locator('.history-page:visible');
  await expect(history).toBeVisible();
  await page.getByTestId('history-search-toggle').click();
  await history.getByRole('textbox').fill('no-matching-history');
  const empty = history.locator('.history-empty');
  await expect(empty).toBeVisible();
  const emptyBounds = (await empty.boundingBox())!;
  const listBounds = (await history.locator('.history-list').boundingBox())!;
  expect(Math.abs(emptyBounds.y + emptyBounds.height / 2 - listBounds.y - listBounds.height / 2)).toBeLessThan(3);
  await history.evaluate(element => { element.setAttribute('data-retained-probe', 'retained'); });
  const singleton = page.locator('[data-tab-kind="history"]');
  await dragTo(page, singleton, page.locator('[data-tab-kind="session"]').first());
  await expect(page.locator('[data-tab-row-id]').first()).toHaveAttribute('data-tab-kind', 'history');
  await expect(history).toHaveAttribute('data-retained-probe', 'retained');
  await expect(history).toBeVisible();
  await expect(empty).toBeVisible();
  await expect(history.getByRole('textbox')).toHaveValue('no-matching-history');
});
