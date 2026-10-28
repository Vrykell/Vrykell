import { test, expect } from '@playwright/test';
import { setupTauriMock, ensureTabsOpen } from './tauri-mock';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  // Open the tab management panel.
  await ensureTabsOpen(page);
  await expect(page.locator('[data-testid="tab-search"]')).toBeVisible();
});

test.describe('Tab management sidebar', () => {
  test('the header lists the search box, history button and new button in order', async ({ page }) => {
    await expect(page.locator('[data-testid="tab-search"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-history-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-new-btn"]')).toBeVisible();
  });

  test('the search box filters active sessions by name', async ({ page }) => {
    // Create a second tab with the shortcut (default title "New session").
    await page.keyboard.press('Meta+t');
    await expect(page.locator('[data-testid^="tab-row-"]')).toHaveCount(2);
    // Filter with no results.
    await page.locator('[data-testid="tab-search"]').fill('不存在的名字');
    await expect(page.locator('[data-testid^="tab-row-"]')).toHaveCount(0);
    await expect(page.getByText('无匹配会话')).toBeVisible();
    // Clearing restores the list.
    await page.locator('[data-testid="tab-search"]').fill('');
    await expect(page.locator('[data-testid^="tab-row-"]')).toHaveCount(2);
  });

  test('clicking new directly opens the compact shell picker and creates the tab', async ({ page }) => {
    await page.locator('[data-testid="tab-new-btn"]').click();
    // No intermediate menu: the shell picker opens directly.
    await expect(page.getByRole('dialog', { name: '新建标签页' })).toBeVisible();
    const picker = page.getByRole('dialog', { name: '新建标签页' });
    await expect(picker.getByText('Zsh', { exact: true })).toBeVisible();
    await expect(picker.getByText('Bash', { exact: true })).toBeVisible();

    // Create a bash tab.
    await picker.getByText('Bash', { exact: true }).click();
    await expect(page.locator('[data-testid^="tab-row-"]')).toHaveCount(2);
    // The picker closes.
    await expect(page.getByRole('dialog', { name: '新建标签页' })).toHaveCount(0);
  });

  test('the history button opens the unified session history workspace', async ({ page }) => {
    await page.locator('[data-testid="tab-history-btn"]').click();
    // The main area renders the session history view (history only; the mock returns one history session and one active session).
    await expect(page.getByText('旧的调试会话')).toBeVisible();
    await expect(page.getByTestId('unified-history-page').locator('.history-count')).toContainText('1 条记录');
  });

  test('the tab context menu stays fully visible near the window edge', async ({ page }) => {
    await page.evaluate(() => {
      const row = document.querySelector<HTMLElement>('[data-tab-row-id]');
      if (!row) throw new Error('Tab row not found');
      row.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: window.innerWidth - 2,
        clientY: window.innerHeight - 2,
      }));
    });

    const menu = page.getByRole('menu', { name: '标签页操作' });
    await expect(menu).toBeVisible();
    const bounds = await menu.boundingBox();
    const viewport = page.viewportSize();
    expect(bounds).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport!.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport!.height);
  });

  test('right-clicking blank space in the tab list opens the panel menu', async ({ page }) => {
    const list = page.locator('[data-reorder-list="session-tabs"]');
    const box = (await list.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 12, { button: 'right' });

    const menu = page.getByRole('menu', { name: '操作菜单' });
    await expect(menu).toBeVisible();
    // The panel menu owns blank areas only, so it carries no row actions.
    await expect(menu.getByRole('button', { name: 'AI 自动分组', exact: true })).toBeVisible();
    await expect(menu.getByRole('button', { name: '关闭标签', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  });

  test('the top + creates an ungrouped tab while only a group + adds to that group', async ({ page }) => {
    await page.keyboard.press('Meta+t');
    const rows = page.locator('[data-tab-row-id]');
    await expect(rows).toHaveCount(2);

    // Create a group on the first tab and make the grouped tab active.
    await rows.first().click({ button: 'right' });
    await page.getByRole('button', { name: '新建分组', exact: true }).click();
    await page.keyboard.press('Escape');
    const group = page.locator('[data-group-id]').first();
    await expect(group).toBeVisible();
    const groupedId = (await group.locator('[data-tab-row-id]').first().getAttribute('data-tab-row-id'))!;
    await group.locator(`[data-testid="tab-row-${groupedId}"]`).click();

    const ids = () => page.locator('[data-tab-row-id]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-tab-row-id')!));
    const before = await ids();
    await page.getByTestId('tab-new-btn').click();
    await page.getByTestId('new-tab-option-shell:zsh').click();
    await expect(page.locator('[data-tab-row-id]')).toHaveCount(before.length + 1);
    const added = (await ids()).find((id) => !before.includes(id))!;
    await expect(page.locator(`[data-testid="tab-row-${added}"]`)).toHaveAttribute('data-tab-group', '');

    // Only the group's own + adds the new tab to that group.
    await group.locator('[data-group-header-id]').hover();
    await group.locator('[data-group-header-id]').click({ button: 'right' });
    await page.getByRole('button', { name: '在此分组新建终端' }).click();
    await page.getByTestId('new-tab-option-shell:zsh').click();
    await expect(page.locator('[data-tab-row-id]')).toHaveCount(before.length + 2);
    const inGroup = (await ids()).find((id) => id !== added && !before.includes(id))!;
    await expect(group.locator(`[data-testid="tab-row-${inGroup}"]`)).toHaveCount(1);
  });

  test('keeps inactive horizontal tab close actions accessible', async ({ page }) => {
    await page.keyboard.press('Meta+t');
    const rows = page.locator('[data-testid^="tab-row-"]');
    await expect(rows).toHaveCount(2);
    // Shared horizontal tabs retain an accessible close action.
    const firstRow = rows.first();
    const close = firstRow.locator('[data-testid^="tab-close-"]');
    await expect(close).toBeVisible();
    // Appears after hovering the row.
    await firstRow.hover();
    await expect(close).toHaveCSS('opacity', '1');
  });
});
