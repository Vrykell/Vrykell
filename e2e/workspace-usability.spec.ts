import { test, expect } from '@playwright/test';
import { setupTauriMock, ptyWrites } from './tauri-mock';
import { gotoSetting } from './settings';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
});

test('navigation supports Enter and Space and shows its active state', async ({ page }) => {
  const nav = page.getByRole('navigation', { name: '工作区导航' });
  const tabs = nav.getByRole('button', { name: '标签', exact: true });
  await expect(tabs).toHaveAttribute('aria-pressed', 'true');
  await tabs.focus();
  await tabs.press('Enter');
  await expect(page.getByTestId('tab-search')).toBeHidden();
  await expect(tabs).toHaveAttribute('aria-pressed', 'false');
  await tabs.press('Space');
  await expect(page.getByTestId('tab-search')).toBeVisible();
});

test('navigation switches panels without losing their local state', async ({ page }) => {
  await page.getByTestId('tab-search').fill('测试筛选');
  await page.locator('[data-dock-btn="ssh"]').click();
  await expect(page.getByTestId('ssh-search')).toBeVisible();
  await expect(page.getByTestId('tab-search')).toBeHidden();
  await page.locator('[data-dock-btn="tabs"]').click();
  await expect(page.getByTestId('tab-search')).toHaveValue('测试筛选');
  await expect(page.getByTestId('ssh-search')).toBeHidden();
});

test('compact navigation and sidebars have separate neutral surfaces', async ({ page }) => {
  const nav = page.getByRole('navigation', { name: '工作区导航' });
  const panel = page.locator('.workspace-side-panel[data-side="left"]:visible');
  expect((await nav.boundingBox())!.width).toBe(44);
  expect((await panel.boundingBox())!.width).toBe(180);
  const active = nav.locator('[aria-pressed="true"]');
  expect(await active.evaluate(el => getComputedStyle(el, '::before').content)).toBe('none');
  await expect(active).toHaveCSS('border-top-style', 'none');
  await expect(page.locator('.workspace-titlebar')).toHaveCSS('border-bottom-style', 'none');
  await expect(panel.locator('.workspace-panel-heading')).toHaveCSS('border-bottom-style', 'none');
  await expect(panel).toHaveCSS('border-right-style', 'none');
  const row = page.locator('[data-tab-row-id]').first();
  await expect(row).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(row.locator(':scope > div > span').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const panelBg = await panel.locator(':scope > div').first().evaluate(el => getComputedStyle(el).backgroundColor);
  expect(panelBg).not.toBe(await nav.evaluate(el => getComputedStyle(el).backgroundColor));
  await expect(nav).toHaveCSS('background-color', await page.locator('.workspace-titlebar').evaluate(el => getComputedStyle(el).backgroundColor));
  const contentBg = await page.locator('main').evaluate(el => getComputedStyle(el).backgroundColor);
  expect(panelBg).not.toBe(contentBg);
  const mainRect = await page.locator('main').boundingBox();
  expect(mainRect!.y).toBeGreaterThan(0);
  expect(mainRect!.y + mainRect!.height).toBeLessThan(800);
});

test('settings and terminal use the same color hierarchy in both themes', async ({ page }) => {
  const background = async (selector: string) => page.locator(selector).evaluate(el => getComputedStyle(el).backgroundColor);
  const terminalBg = await background('main');
  await gotoSetting(page, '模型配置');
  await expect(page.locator('input[type="password"]')).toBeVisible();
  expect(await background('.settings-content')).toBe(terminalBg);
  expect(await background('.settings-navigation')).not.toBe(terminalBg);
  const darkFrame = await background('.workspace-titlebar');
  await page.locator('aside').getByRole('button', { name: '主题', exact: true }).click();
  for (const label of ['浅色', '深色']) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', label === '浅色' ? 'light' : 'dark');
    expect(await background('.workspace-titlebar')).toBe(await background('.workspace-activity-bar'));
    expect(await background('.workspace-titlebar')).not.toBe(await background('main'));
    expect(await background('.workspace-side-panel[data-side="left"]:visible > div:first-child')).not.toBe(await background('.workspace-activity-bar'));
    expect(await background('.settings-content')).toBe(await background('main'));
    const aliases = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      return ['--text-title', '--text-primary', '--tab-hover', '--hover'].map(key => css.getPropertyValue(key).trim());
    });
    expect(aliases[0]).toBe(aliases[1]);
    expect(aliases[2]).toBe(aliases[3]);
    if (label === '浅色') expect(await background('.workspace-titlebar')).not.toBe(darkFrame);
  }
});

test('sidebar resize edges remain visible and strengthen during dragging on both sides', async ({ page }) => {
  await page.locator('[data-dock-btn="chat"]').click();
  for (const id of ['tabs', 'chat']) {
    const handle = page.getByTestId(`resize-handle-${id}`);
    const line = handle.locator('[data-resize-line]');
    const borderColor = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--border').trim());
    const accentColor = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    await expect(line).toHaveCSS('background-color', borderColor);
    await expect(handle).toHaveCSS('cursor', 'col-resize');
    expect((await handle.boundingBox())!.width).toBeGreaterThanOrEqual(8);
    const panel = handle.locator('..');
    const before = (await panel.boundingBox())!.width;
    const rect = (await handle.boundingBox())!;
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    await page.mouse.move(x, y);
    await expect(line).toHaveCSS('background-color', accentColor);
    await page.mouse.down();
    await page.mouse.move(x + (id === 'tabs' ? 40 : -40), y);
    await page.mouse.move(x + (id === 'tabs' ? 40 : -40), y + 80);
    await expect(line).toHaveCSS('background-color', accentColor);
    expect((await panel.boundingBox())!.width).toBe(before + 40);
    await page.mouse.up();
    await page.mouse.move(700, 700);
    await expect(line).toHaveCSS('background-color', borderColor);
  }
});

test('narrow layouts preserve command space and fit the toolbar', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 480 });
  await page.locator('[data-dock-btn="files"]').click();
  await page.locator('[data-dock-btn="ssh"]').click();
  await expect(page.getByTestId('ssh-search')).toBeVisible();
  await expect(page.getByText('notes.txt')).toBeHidden();
  const main = await page.locator('main').boundingBox();
  expect(main!.width).toBeGreaterThanOrEqual(360);
  await expect(page.getByTitle('关闭当前终端')).toBeInViewport();
  const overlap = await page.evaluate(() => {
    const search = document.querySelector('[data-testid="global-search-trigger"]')!.getBoundingClientRect();
    const ai = document.querySelector('[data-dock-btn="chat"]')!.getBoundingClientRect();
    return search.right > ai.left;
  });
  expect(overlap).toBe(false);
});

test('AI drafts stay separate when opening the AI assistant', async ({ page }) => {
  await page.getByRole('button', { name: '命令', exact: true }).click();
  await page.getByPlaceholder(/自然语言描述/).fill('帮我解释这个项目');
  await page.locator('[data-dock-btn="chat"]').click();
  const command = page.getByPlaceholder(/输入命令/);
  await expect(command).toHaveValue('');
  await command.press('Enter');
  expect(await ptyWrites(page)).not.toContain('帮我解释这个项目\n');
  await page.locator('[data-dock-btn="chat"]').click();
  await page.getByRole('button', { name: '命令', exact: true }).click();
  await expect(page.getByPlaceholder(/自然语言描述/)).toHaveValue('帮我解释这个项目');
});

test('separate command and AI drafts survive repeated switches', async ({ page }) => {
  await page.getByPlaceholder(/输入命令/).fill('git status');
  await page.getByRole('button', { name: '命令', exact: true }).click();
  await expect(page.getByPlaceholder(/自然语言描述/)).toHaveValue('');
  await page.getByPlaceholder(/自然语言描述/).fill('解释当前修改');
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await expect(page.getByPlaceholder(/输入命令/)).toHaveValue('git status');
});

test('split placement explains selection and cancellation before hover', async ({ page }) => {
  await page.getByTitle('选择类型分裂', { exact: true }).click();
  await page.getByTestId('new-tab-option-shell:zsh').click();
  await expect(page.getByTestId('placement-hint')).toBeVisible();
  await expect(page.getByTestId('placement-hint')).toContainText('Esc 取消');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('placement-hint')).toHaveCount(0);
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
});

test('navigation controls only the adjacent sidebar and AI has an independent entrance', async ({ page }) => {
  await expect(page.locator('[data-dock-btn="chat"]')).toHaveAttribute('title', '打开 AI 助手');
  await page.locator('[data-dock-btn="files"]').click();
  await expect(page.getByText('notes.txt')).toBeVisible();
  await expect(page.getByTestId('tab-search')).toBeHidden();
  await expect(page.locator('.workspace-side-panel[data-side="left"]:visible')).toHaveCount(1);
  await expect(page.locator('.workspace-side-panel[data-side="right"]:visible')).toHaveCount(0);
  await page.locator('[data-dock-btn="chat"]').click();
  await expect(page.locator('.workspace-side-panel[data-side="right"]:visible')).toHaveCount(1);
  await expect(page.getByText('notes.txt')).toBeVisible();
  await page.locator('[data-dock-btn="tabs"]').click();
  await expect(page.getByTestId('tab-search')).toBeVisible();
  await expect(page.getByPlaceholder(/自然语言描述/)).toBeVisible();
  await expect(page.getByRole('navigation', { name: '工作区导航' }).getByRole('button', { name: '设置', exact: true })).toHaveCount(0);
  await expect(page.locator('header').getByRole('button', { name: '设置', exact: true })).toBeVisible();
});

test('panel headings close their own content without affecting the other side', async ({ page }) => {
  await page.locator('[data-dock-btn="chat"]').click();
  await page.getByRole('button', { name: '关闭AI 助手面板', exact: true }).click();
  await expect(page.getByPlaceholder(/自然语言描述/)).toBeHidden();
  await expect(page.getByTestId('tab-search')).toBeVisible();
  await page.getByRole('button', { name: '关闭标签面板', exact: true }).click();
  await expect(page.getByTestId('tab-search')).toBeHidden();
});

test('dragging a navigation action preserves panel placement and order', async ({ page }) => {
  await page.locator('[data-dock-btn="files"]').dragTo(page.locator('[data-dock-btn="ssh"]'));
  const ids = await page.getByRole('navigation', { name: '工作区导航' }).locator('[data-dock-btn]').evaluateAll(elements => elements.map(el => el.getAttribute('data-dock-btn')));
  expect(ids).toEqual(['tabs', 'files', 'ssh']);
  await page.locator('[data-dock-btn="files"]').click();
  await expect(page.getByText('notes.txt')).toBeVisible();
  await expect(page.getByTestId('tab-search')).toBeHidden();
  await expect(page.locator('.workspace-side-panel[data-side="left"]:visible')).toHaveCount(1);
});
