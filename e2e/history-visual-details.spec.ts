import { expect, test, type Locator } from '@playwright/test';
import { ensureTabsOpen, setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

async function centerY(element: Locator) {
  const box = (await element.boundingBox())!;
  return box.y + box.height / 2;
}

for (const theme of ['dark', 'light'] as const) {
  test(`history details use clear actions, single-line headers and scoped menus in ${theme}`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await setupTauriMock(page, { schedulesSeed: [], groupedHistoricalSession: true });
    await page.goto('/');
    await page.evaluate(() => {
      const now = Date.now();
      localStorage.setItem('e2e-conversations', JSON.stringify([
        { id: 'review', title: 'Review deployment' }, { id: 'notes', title: 'Deployment notes' },
      ].map(item => ({ ...item, created_at: now, updated_at: now, environment: 'null' }))));
    });
    await page.reload();
    await gotoSetting(page, '主题');
    await page.getByRole('radio', { name: theme === 'dark' ? '深色' : '浅色', exact: true }).click();
    const importTheme = page.getByRole('button', { name: '导入主题', exact: true });
    await importTheme.scrollIntoViewIfNeeded();
    await expect(importTheme).toHaveCSS('display', /^(inline-)?flex$/);
    expect(Math.abs(await centerY(importTheme) - await centerY(importTheme.locator('svg')))).toBeLessThan(1);
    const surfaces = await importTheme.evaluate(element => ({
      button: getComputedStyle(element).backgroundColor,
      card: getComputedStyle(element.closest('.settings-group-panel')!).backgroundColor,
      border: getComputedStyle(element).borderTopColor,
    }));
    expect(surfaces.button).not.toBe(surfaces.card);
    expect(surfaces.border).toBe('rgba(0, 0, 0, 0)');
    await page.screenshot({ path: testInfo.outputPath(`settings-solid-actions-${theme}.png`), animations: 'disabled' });

    await ensureTabsOpen(page);
    await page.getByTestId('tab-history-btn').click();
    await expect(page.locator('.history-header')).toHaveCSS('border-bottom-width', '0px');
    const card = page.getByTestId('history-group-card-source:archived-group');
    await expect(card.locator('.history-group-primary')).toHaveCount(0);
    expect(Math.abs(await centerY(card.getByRole('heading')) - await centerY(card.locator('.history-group-count')))).toBeLessThan(3);
    const row = page.getByTestId('history-session-hist-group-1');
    await page.mouse.move(2, 2);
    const restore = page.getByTestId('session-restore-hist-group-1');
    await expect(restore).toBeHidden();
    await expect(row.locator('.sidebar-row-subtitle')).toBeVisible();
    await expect(row.locator('.sidebar-row-subtitle')).toContainText('/project/docs');
    await row.hover();
    await expect(restore).toBeVisible();
    await expect(row.getByRole('button')).toHaveCount(3);
    await expect(row.getByText('恢复', { exact: true })).toHaveCount(0);
    const quick = row.locator('.history-row-quick-actions');
    await expect(quick).toHaveCSS('background-color', await card.evaluate(element => getComputedStyle(element).backgroundColor));
    const quickBox = (await quick.boundingBox())!;
    const listBox = (await page.locator('.history-list').boundingBox())!;
    expect(quickBox.x).toBeGreaterThanOrEqual(listBox.x);
    for (const button of await quick.getByRole('button').all()) {
      const box = (await button.boundingBox())!;
      expect(box.width).toBe(24);
      expect(box.height).toBe(24);
      expect(Math.abs(await centerY(button) - await centerY(row.locator('.sidebar-row-title')))).toBeLessThan(1);
      await expect(button).toHaveCSS('border-top-width', '0px');
    }
    await restore.hover();
    await expect(restore).toBeVisible();
    await row.hover();
    await expect(row.locator('.sidebar-row-title')).toHaveCSS('font-size', '14px');
    await expect(row.locator('.sidebar-row-title')).toHaveCSS('text-decoration-line', 'underline');
    const channels = await row.locator('.sidebar-row-title').evaluate(element => getComputedStyle(element).color.match(/[0-9.]+/g)!.slice(0, 3).map(Number));
    expect(channels[2]!).toBeGreaterThan(channels[0]!);
    await expect(row.locator('.history-row-icon svg')).toHaveCSS('width', '16px');
    await expect(row.locator('.sidebar-row-content')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await row.click({ button: 'right' });
    await expect(page.getByRole('menu', { name: '分组操作' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: '加星标', exact: true }).click();
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '锁定记录', exact: true }).click();
    await row.click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: '删除此会话', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await row.hover();
    await expect(page.getByTestId('session-delete-hist-group-1')).toBeDisabled();
    await expect(restore).toBeEnabled();
    for (const flag of ['.history-row-star', '.history-row-lock']) {
      await expect(row.locator(`${flag} svg`)).toHaveCSS('width', '16px');
      await expect(row.locator(`${flag} svg`)).toHaveAttribute('viewBox', '0 0 16 16');
    }
    await page.screenshot({ path: testInfo.outputPath(`history-record-${theme}.png`), animations: 'disabled' });

    await card.getByRole('heading').click({ button: 'right' });
    const menu = page.getByRole('menu', { name: '分组操作' });
    await expect(menu.getByRole('menuitem', { name: '恢复整组', exact: true })).toBeVisible();
    const widths = await menu.getByRole('separator').evaluateAll(elements => elements.map(element => getComputedStyle(element).borderTopWidth));
    expect(widths.length).toBeGreaterThan(2);
    expect(new Set(widths).size).toBe(1);
    expect(parseFloat(widths[0]!)).toBeGreaterThan(0);
    await expect(menu.locator('.context-menu-footer')).toHaveCSS('border-top-width', '0px');
    await page.screenshot({ path: testInfo.outputPath(`history-group-menu-${theme}.png`), animations: 'disabled' });
    await page.keyboard.press('Escape');

    await card.getByRole('button', { name: '分组颜色', exact: true }).click();
    const palette = page.getByRole('dialog', { name: '分组颜色' });
    const swatches = palette.locator('.history-palette-swatch');
    const first = (await swatches.first().boundingBox())!;
    const last = (await swatches.last().boundingBox())!;
    const automatic = (await palette.getByRole('button', { name: '自动配色' }).boundingBox())!;
    expect(Math.abs(first.x - automatic.x)).toBeLessThan(1);
    expect(Math.abs(last.x + last.width - automatic.x - automatic.width)).toBeLessThan(1);
    expect(Math.abs(first.y - last.y)).toBeLessThan(1);
    expect(Math.abs(first.width - first.height)).toBeLessThan(1);
    await page.screenshot({ path: testInfo.outputPath(`history-palette-${theme}.png`), animations: 'disabled' });
    await page.keyboard.press('Escape');

    if (!await page.locator('[data-chat-composer]').isVisible()) await page.locator('[data-dock-btn="chat"]').click();
    await page.getByRole('button', { name: 'AI 对话历史', exact: true }).click();
    const aiCard = page.getByTestId('ai-history-page').locator('.history-group-card');
    const selected = page.getByTestId('conversation-row-review');
    await expect(selected.locator('.sidebar-row-subtitle')).toBeVisible();
    await expect(selected.locator('.sidebar-row-subtitle')).toContainText('更新于');
    await selected.hover();
    await page.getByTestId('conversation-open-review').click();
    await expect(selected).toHaveAttribute('aria-current', 'true');
    if (await page.locator('[data-chat-composer]').isVisible()) await page.locator('[data-dock-btn="chat"]').click();
    await selected.hover();
    await expect(selected.getByRole('button')).toHaveCount(3);
    await expect(selected.locator('.sidebar-row-content')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(selected.locator('.sidebar-row-title')).toHaveCSS('text-decoration-line', 'underline');
    await page.screenshot({ path: testInfo.outputPath(`ai-history-hover-${theme}.png`), animations: 'disabled' });
    await aiCard.getByRole('heading').click({ button: 'right' });
    await expect(menu.getByRole('menuitem', { name: '复制为 Markdown', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    const notes = page.getByTestId('conversation-row-notes');
    await notes.hover();
    await page.getByTestId('conversation-delete-notes').click();
    await expect(notes).toHaveCount(0);
    await expect(selected).toHaveAttribute('aria-current', 'true');
  });
}

test('quick controls restore one original member with the keyboard and delete without restoring', async ({ page }) => {
  await setupTauriMock(page, { schedulesSeed: [], groupedHistoricalSession: true });
  await page.goto('/');
  await ensureTabsOpen(page);
  await page.getByTestId('tab-history-btn').click();
  const first = page.getByTestId('history-session-hist-group-1');
  await first.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('session-delete-hist-group-1')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('session-restore-hist-group-1')).toBeFocused();
  await page.keyboard.press('Enter');
  await ensureTabsOpen(page);
  await expect(page.getByTestId('tab-row-hist-group-1')).toHaveAttribute('data-tab-group', 'archived-group');
  await expect(page.getByTestId('tab-row-hist-group-2')).toHaveCount(0);
  await page.getByTestId('tab-history-btn').click();
  await expect(first).toHaveCount(0);
  const second = page.getByTestId('history-session-hist-group-2');
  await second.hover();
  await page.getByTestId('session-delete-hist-group-2').click();
  await expect(second).toHaveCount(0);
  await expect(page.getByTestId('tab-row-hist-group-2')).toHaveCount(0);
  await expect(page.getByTestId('history-session-hist-group-3')).toBeVisible();
});
