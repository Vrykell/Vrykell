import { test, expect, type Locator } from '@playwright/test';
import { setupTauriMock, ensureTabsOpen } from './tauri-mock';
import { gotoSetting } from './settings';
import { focusedPane, pickPlacementZone } from './placement';

async function expectQuietFocus(control: Locator) {
  const border = await control.evaluate(element => getComputedStyle(element).borderColor);
  await control.focus();
  await expect(control).toBeFocused();
  await expect(control).toHaveCSS('outline-style', 'none');
  await expect(control).toHaveCSS('box-shadow', 'none');
  await expect(control).toHaveCSS('border-color', border);
}

for (const theme of ['深色', '浅色']) {
  test(`settings pages and editor focus stay consistent in ${theme}`, async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await gotoSetting(page, '主题');
    await page.getByRole('radio', { name: theme, exact: true }).click();
    const nav = page.locator('.settings-navigation');
    const labels = ['启动', '日志与诊断', '模型配置', '模型行为', '工具权限', '联网搜索', '技能',
      'MCP 服务器', '内存', '子代理', '定时任务', '打开方式', '本地编辑器', '远程编辑器', '主题',
      '块外观', '字体与显示', '主题文件', '快捷键说明'];
    for (const [index, label] of labels.entries()) {
      await nav.getByRole('button', { name: label, exact: true }).click();
      const content = page.locator('.settings-content');
      await expect(content.getByText(label, { exact: true }).first()).toBeVisible();
      const overflow = await content.evaluate(element => element.scrollWidth - element.clientWidth);
      expect(overflow, label).toBeLessThanOrEqual(1);
      const controls = content.locator('input:not([type="checkbox"]):not([type="range"]):enabled, textarea:enabled, button[role="combobox"]:enabled');
      for (const control of await controls.all()) {
        if (await control.isVisible()) await expectQuietFocus(control);
      }
      await page.mouse.move(0, 0);
      await page.screenshot({ path: test.info().outputPath(`settings-${index}.png`), animations: 'disabled' });
    }
    await page.keyboard.press('Meta+1');
    await expectQuietFocus(page.getByPlaceholder(/输入命令/));
    await expect(page.locator('.terminal-composer')).toHaveCSS('box-shadow', 'none');
    await ensureTabsOpen(page);
    await page.getByTestId('tab-history-btn').click();
    await page.getByTestId('history-search-toggle').click();
    const history = page.getByTestId('unified-history-search');
    await expectQuietFocus(history);
    const hierarchy = await history.evaluate(element => ({
      field: getComputedStyle(element.parentElement!).backgroundColor,
      panel: getComputedStyle(element.closest('main')!.firstElementChild!).backgroundColor,
    }));
    expect(hierarchy.field).not.toBe(hierarchy.panel);
    await history.fill('旧的调试会话');
    await expect(page.getByText('旧的调试会话', { exact: true })).toBeVisible();
  });

  test(`inline editors and split dividers keep resting edges in ${theme}`, async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await gotoSetting(page, '主题');
    await page.getByRole('radio', { name: theme, exact: true }).click();
    await page.keyboard.press('Meta+1');
    const expectRestingEdge = async (input: Locator) => {
      await expectQuietFocus(input);
      const edge = await input.evaluate(element => {
        const probe = document.createElement('span');
        probe.style.border = '1px solid var(--border)';
        element.parentElement!.append(probe);
        const result = { actual: getComputedStyle(element).borderColor, expected: getComputedStyle(probe).borderColor };
        probe.remove();
        return result;
      });
      expect(edge.actual).toBe(edge.expected);
    };
    await ensureTabsOpen(page);
    const row = page.getByTestId('tab-row-t1');
    await row.dblclick();
    await expectRestingEdge(row.getByRole('textbox'));
    await row.getByRole('textbox').press('Escape');
    await page.locator('[data-dock-btn="files"]').click();
    const bar = page.getByTestId('crumb-bar');
    await bar.locator('[data-tip="单击编辑路径，回车跳转"]').click();
    await expectRestingEdge(page.getByTestId('path-input'));
    await page.getByTestId('path-input').press('Escape');
    await page.getByText('notes.txt', { exact: true }).click({ button: 'right' });
    await page.getByRole('button', { name: '重命名', exact: true }).click();
    await expectRestingEdge(page.getByTestId('rename-input'));
    await page.getByTestId('rename-input').press('Escape');
    await page.getByPlaceholder(/输入命令/).focus();
    await page.keyboard.press('Meta+d');
    await pickPlacementZone(page, focusedPane(page), 'right');
    const panes = page.locator('.terminal-pane');
    await expect(panes).toHaveCount(2);
    const borders = () => panes.evaluateAll(elements => elements.map(element => {
      const style = getComputedStyle(element);
      return [style.borderTop, style.borderRight, style.borderBottom, style.borderLeft];
    }));
    const resting = await borders();
    await panes.first().getByPlaceholder(/输入命令/).click();
    await expect(panes.first()).toHaveAttribute('data-focused', 'true');
    expect(await borders()).toEqual(resting);
    await panes.last().getByPlaceholder(/输入命令/).click();
    await expect(panes.last()).toHaveAttribute('data-focused', 'true');
    expect(await borders()).toEqual(resting);
  });

  test(`search has inset query fields and flat controls in ${theme}`, async ({ page }) => {
    await setupTauriMock(page);
    await page.addInitScript(() => localStorage.setItem('vrykell-search-history', JSON.stringify(['npm', '> f', '>', '@ 渲染'])));
    await page.goto('/');
    await gotoSetting(page, '主题');
    await page.getByRole('radio', { name: theme, exact: true }).click();
    await page.keyboard.press('Meta+1');
    await page.getByTestId('global-search-trigger').click();
    const dialog = page.getByRole('dialog', { name: '全局搜索' });
    const input = dialog.getByRole('textbox', { name: '搜索工作区' });
    await expectQuietFocus(input);
    await expect(dialog.locator('.global-search-input-row')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const header = (await dialog.locator('header').boundingBox())!;
    const query = (await dialog.locator('.global-search-query').boundingBox())!;
    expect(query.y - header.y).toBeGreaterThanOrEqual(10);
    expect(header.y + header.height - query.y - query.height).toBeGreaterThanOrEqual(10);
    for (const control of [dialog.getByTestId('search-filter-button'), dialog.getByRole('button', { name: '清除', exact: true })]) {
      await expect(control).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(control).toHaveCSS('border-top-width', '0px');
      await expectQuietFocus(control);
    }
    for (const label of await dialog.getByTestId('history-scope-chip').all()) {
      await expect(label).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    }
    await input.focus();
    await page.mouse.move(0, 0);
    await dialog.screenshot({ path: test.info().outputPath('search-history.png'), animations: 'disabled' });
    await dialog.getByTestId('search-filter-button').press('Enter');
    await expect(dialog.getByRole('menu')).toBeVisible();
    await expectQuietFocus(dialog.getByRole('menuitemcheckbox').first());
    await input.press('Escape');
    await expect(dialog.getByRole('menu')).toBeHidden();
    await dialog.getByRole('button', { name: '清除', exact: true }).click();
    await expect(dialog.locator('.global-search-history')).toHaveCount(0);
    await expect(dialog.locator('.global-search-sources > button')).toHaveCount(6);
    await expect(dialog.getByText('6 个搜索来源')).toBeVisible();
    await page.mouse.move(0, 0);
    await dialog.screenshot({ path: test.info().outputPath('search-empty.png'), animations: 'disabled' });
    await input.fill('npm');
    await expect(dialog.locator('[data-search-result]').first()).toBeVisible();
    await input.press('ArrowDown');
    await expect(dialog.locator('[data-search-result][data-selected="true"]')).toHaveCount(1);
    await input.press('Escape');
    await expect(dialog).toBeHidden();
  });
}
