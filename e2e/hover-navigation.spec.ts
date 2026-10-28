import { expect, test, type Locator, type Page } from '@playwright/test';
import { acpUpdate, emitAcpSession, setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

async function highlighted(rows: Locator) {
  return rows.evaluateAll(elements => elements.filter(element => getComputedStyle(element).backgroundColor !== 'rgba(0, 0, 0, 0)').length);
}

async function checkMenuInput(page: Page, menu: Locator) {
  await expect(menu).toBeVisible();
  const rows = menu.locator('.workspace-floating-row:not(:disabled):not([aria-haspopup="menu"])');
  expect(await rows.count()).toBeGreaterThan(1);
  await rows.first().focus();
  await page.keyboard.press('Home');
  await expect(menu).toHaveAttribute('data-keyboard-navigation', 'true');
  await rows.last().hover();
  await expect(menu).toHaveAttribute('data-keyboard-navigation', 'false');
  await expect.poll(() => highlighted(rows)).toBe(1);
  await page.mouse.move(5, 5);
  await expect.poll(() => highlighted(rows)).toBe(0);
  await page.keyboard.press('ArrowDown');
  await expect(menu).toHaveAttribute('data-keyboard-navigation', 'true');
  await expect.poll(() => highlighted(rows)).toBe(1);
  await rows.last().hover();
  await expect(menu).toHaveAttribute('data-keyboard-navigation', 'false');
  await expect(rows.last()).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect.poll(() => highlighted(rows)).toBe(1);
}

for (const theme of ['dark', 'light'] as const) {
  for (const width of [1240, 700]) test(`settings hover stays under the pointer at ${width}px in ${theme}`, async ({ page }, info) => {
    await setupTauriMock(page, {});
    await page.addInitScript(theme => localStorage.setItem('vrykell-theme-mode', theme), theme);
    await page.goto('/');
    await gotoSetting(page, '字体与显示');
    await page.setViewportSize({ width, height: 700 });
    const navigation = page.getByRole('complementary', { name: '设置目录' });
    const focused = navigation.getByRole('button', { name: '模型行为', exact: true });
    await focused.focus();
    await focused.press('ArrowDown');
    await expect.poll(() => highlighted(navigation.locator('.sidebar-row-content'))).toBe(1);
    await navigation.getByRole('button', { name: '模型配置', exact: true }).hover();
    await expect(navigation).toHaveAttribute('data-keyboard-navigation', 'false');
    await expect.poll(() => highlighted(navigation.locator('.sidebar-row-content'))).toBe(2);
    await expect(navigation.getByRole('button', { name: '字体与显示', exact: true })).toHaveAttribute('aria-current', 'page');
    await navigation.locator('.settings-navigation-list').evaluate(element => { element.scrollTop = 0; });
    await expect(navigation.getByRole('button', { name: '字体与显示', exact: true })).toHaveAttribute('aria-current', 'page');

    const trigger = page.getByRole('combobox', { name: '终端字号' });
    const initialValue = await trigger.innerText();
    await trigger.click();
    const list = page.getByRole('listbox', { name: '终端字号' });
    await expect(list).toBeVisible();
    await list.evaluate(element => { element.scrollTop = 13; });
    const bounds = (await list.boundingBox())!;
    await page.mouse.move(bounds.x + 24, bounds.y + 3);
    await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(13);
    await expect.poll(() => highlighted(list.getByRole('option'))).toBe(1);
    await expect(list.locator('[data-active="true"]')).toHaveCount(0);
    await trigger.press('End');
    await expect(list.getByRole('option', { name: '24px', exact: true })).toHaveAttribute('data-active', 'true');
    await expect(list.getByRole('option', { name: '24px', exact: true })).toBeInViewport();
    await expect.poll(() => highlighted(list.getByRole('option'))).toBe(1);
    const before = await list.evaluate(element => element.scrollTop);
    await page.mouse.move(bounds.x + 30, bounds.y + 4);
    await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(before);
    await expect.poll(() => highlighted(list.getByRole('option'))).toBe(1);
    await page.screenshot({ path: info.outputPath(`settings-hover-${theme}-${width}.png`), animations: 'disabled' });
    await page.mouse.move(5, 5);
    await expect.poll(() => highlighted(list.getByRole('option'))).toBe(0);
    await trigger.press('Escape');
    await expect(trigger).toHaveText(initialValue);
  });

  test(`action, history, source and conversation menus do not retain stale highlights in ${theme}`, async ({ page }, info) => {
    await setupTauriMock(page, {});
    await page.addInitScript(theme => localStorage.setItem('vrykell-theme-mode', theme), theme);
    await page.goto('/');
    await page.locator('[data-tab-row-id]').first().click({ button: 'right' });
    await checkMenuInput(page, page.getByRole('menu').first());
    await page.screenshot({ path: info.outputPath(`actions-hover-${theme}.png`), animations: 'disabled' });
    await page.keyboard.press('Escape');

    await page.getByTestId('workspace-history').click();
    await page.getByTestId('unified-history-sort').click();
    await checkMenuInput(page, page.getByTestId('unified-history-sort-menu'));
    await page.screenshot({ path: info.outputPath(`history-hover-${theme}.png`), animations: 'disabled' });
    await page.keyboard.press('Escape');

    await page.getByTestId('global-search-trigger').click();
    await page.getByTestId('search-filter-button').click();
    const sourceMenu = page.getByRole('menu', { name: '搜索范围' });
    await checkMenuInput(page, sourceMenu);
    await page.screenshot({ path: info.outputPath(`source-hover-${theme}.png`), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '关闭搜索', exact: true }).click();

    const approval = page.getByTestId('chat-approval-select');
    if (!(await approval.isVisible())) await page.locator('[data-dock-btn="chat"]').click();
    await approval.click();
    const approvalMenu = page.getByRole('listbox', { name: '对话与审批模式' });
    await checkMenuInput(page, approvalMenu);
    await page.screenshot({ path: info.outputPath(`conversation-hover-${theme}.png`), animations: 'disabled' });
    await expect(approvalMenu.getByRole('option', { selected: true })).toHaveCount(1);
    await page.keyboard.press('Escape');
    await approval.press('ArrowDown');
    await expect(approvalMenu).toHaveAttribute('data-keyboard-navigation', 'true');
    await expect.poll(() => highlighted(approvalMenu.getByRole('option'))).toBe(1);
  });

  test(`agent selectors and slash commands hand highlighting to the pointer in ${theme}`, async ({ page }, info) => {
    await setupTauriMock(page, {});
    await page.addInitScript(theme => localStorage.setItem('vrykell-theme-mode', theme), theme);
    await page.goto('/');
    await page.getByTestId('workspace-area-ai').click();
    await page.getByTestId('harness-add-session').click();
    await page.getByTestId('acp-launcher-Fake ACP').click();
    const composer = page.getByTestId('harness-composer');
    await expect(composer).toBeVisible();
    const selector = page.getByTestId('harness-selector-mode');
    await selector.click();
    const menu = page.getByRole('listbox');
    await checkMenuInput(page, menu);
    await expect(menu.getByRole('option', { selected: true })).toHaveCount(1);
    await page.keyboard.press('Escape');
    await selector.press('ArrowDown');
    await expect(menu).toHaveAttribute('data-keyboard-navigation', 'true');
    await expect.poll(() => highlighted(menu.getByRole('option'))).toBe(1);
    await page.keyboard.press('Escape');
    await emitAcpSession(page, acpUpdate('sess_e2e', {
      sessionUpdate: 'available_commands_update', availableCommands: [
        { name: 'web', description: 'Search the web' }, { name: 'review', description: 'Review changes' },
      ],
    }));
    await composer.fill('/');
    const commands = page.getByTestId('harness-commands');
    const rows = commands.getByRole('option');
    await expect(rows).toHaveCount(2);
    await rows.last().hover();
    await expect(commands).toHaveAttribute('data-keyboard-navigation', 'false');
    await expect.poll(() => highlighted(rows)).toBe(1);
    await composer.hover();
    await expect.poll(() => highlighted(rows)).toBe(0);
    await composer.press('ArrowDown');
    await expect(commands).toHaveAttribute('data-keyboard-navigation', 'true');
    await expect.poll(() => highlighted(rows)).toBe(1);
    await rows.last().hover();
    await expect(commands).toHaveAttribute('data-keyboard-navigation', 'false');
    await expect(rows.last()).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect.poll(() => highlighted(rows)).toBe(1);
    await page.screenshot({ path: info.outputPath(`agent-commands-hover-${theme}.png`), animations: 'disabled' });
    await expect(composer).toHaveValue('/');
  });
}
