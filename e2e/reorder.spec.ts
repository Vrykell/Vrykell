import { test, expect, type Page } from '@playwright/test';
import { setupTauriMock, ensureTabsOpen } from './tauri-mock';

/** Press the pointer on a row and drag it onto `ratio` of the target row (mouse stays down). */
async function startDragRow(page: Page, sourceTestId: string, targetTestId: string, ratio = 0.8, grabOffset = 40) {
  const from = (await page.getByTestId(sourceTestId).boundingBox())!;
  const horizontal = sourceTestId.startsWith('tab-row-');
  const originalTarget = (await page.getByTestId(targetTestId).boundingBox())!;
  const startX = from.x + Math.min(grabOffset, Math.max(1, from.width - 1));
  await page.mouse.move(startX, from.y + from.height / 2);
  await page.mouse.down();
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    const target = horizontal ? originalTarget : (await page.getByTestId(targetTestId).boundingBox())!;
    const toX = target.x + (horizontal ? target.width * ratio : 40);
    const toY = target.y + target.height * (horizontal ? 0.5 : ratio);
    await page.mouse.move(
      startX + (toX - startX) * (i / steps),
      from.y + from.height / 2 + (toY - (from.y + from.height / 2)) * (i / steps),
    );
    await page.waitForTimeout(12);
  }
}

const sshOrder = (page: Page) =>
  page.locator('[data-reorder-item][data-reorder-kind="ssh"]')
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.reorderItem));

const tabOrder = (page: Page) =>
  page.locator('[data-tab-row-id]')
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.reorderItem));

test.describe('sidebar list drag reordering', () => {
  for (const singleton of [false, true]) {
    test(`dragging out of a group uses the empty ungrouped area${singleton ? ' with singleton pages' : ''}`, async ({ page }) => {
      await setupTauriMock(page);
      await page.goto('/');
      await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
      await ensureTabsOpen(page);
      const { first, groupId } = await page.evaluate(async withSingleton => {
        const path = '/src/features/workspace/stores/workspace.ts';
        const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
        const store = useWorkspaceStore.getState();
        const first = store.tabs.find(tab => tab.kind === 'session')!.id;
        const second = store.addTab({ title: 'Grouped second' });
        const workbenchPath = '/src/features/workspace/services/workbench.ts';
        const { synchronizeWorkbench, createContainerGroup, assignWorkspaceGroup } = await import(workbenchPath) as typeof import('../src/features/workspace/services/workbench');
        synchronizeWorkbench();
        const groupId = await createContainerGroup(first, 'Regression group');
        await assignWorkspaceGroup(second, groupId);
        if (withSingleton) store.openHistoryTab();
        return { first, groupId };
      }, singleton);
      const source = page.getByTestId(`tab-row-${first}`);
      const from = (await source.boundingBox())!;
      const list = page.locator('[data-reorder-list="session-tabs"]');
      const viewport = (await list.boundingBox())!;
      const loose = list.locator('[data-reorder-zone="ungrouped"]');
      const heading = (await loose.boundingBox())!;
      await page.mouse.move(from.x + 40, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(heading.x + 8, viewport.y + viewport.height / 2, { steps: 5 });
      for (const x of [heading.x + 12, Math.min(heading.x + heading.width - 8, viewport.x + viewport.width - 8)]) {
        await page.mouse.move(x, viewport.y + viewport.height / 2, { steps: 5 });
        await expect(loose.locator('[data-reorder-placeholder]')).toHaveCount(1);
        await expect(list.locator(`[data-group-id="${groupId}"] [data-reorder-placeholder]`)).toHaveCount(0);
      }
      await page.mouse.up();
      await expect(source).toHaveAttribute('data-tab-group', '');
      await expect(list.locator(`[data-tab-row-id="${first}"]`)).toHaveCount(1);
      await expect(list.locator(`[data-group-id="${groupId}"] [data-tab-row-id="${first}"]`)).toHaveCount(0);
    });
  }
  test('SSH connections: the source row makes way with a dashed placeholder while dragging, and the order persists after dropping', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await page.locator('[data-dock-btn="ssh"]').click();
    await expect(page.locator('[data-testid="ssh-search"]')).toBeVisible();

    // The mock has only one connection by default: create another one for reordering
    await page.locator('[data-testid="ssh-new-btn"]').click();
    await page.locator('[data-testid="ssh-form-name"]').fill('备用机');
    await page.locator('[data-testid="ssh-form-host"]').fill('backup.example.com');
    await page.locator('[data-testid="ssh-save-btn"]').click();
    await expect(page.getByText('备用机')).toBeVisible();

    const before = await sshOrder(page);
    expect(before).toHaveLength(2);
    const [first, second] = before as [string, string];

    await startDragRow(page, `ssh-row-${first}`, `ssh-row-${second}`, 0.85);
    // While dragging: the source row makes way (hidden) and the drop slot uses a dashed placeholder
    await expect(page.locator(`[data-testid="ssh-row-${first}"]`)).toHaveAttribute('data-reorder-dragging', 'true');
    await expect(page.locator('[data-reorder-placeholder]')).toHaveCount(1);
    await page.mouse.up();

    expect(await sshOrder(page)).toEqual([second, first]);
    // The new order is written to local storage (the store's load arranges by it; unit tests cover that path)
    const stored = await page.evaluate(() => localStorage.getItem('vrykell-ssh-order'));
    expect(JSON.parse(stored ?? 'null')).toEqual([second, first]);
  });

  test('tabs: the source row makes way with a placeholder while dragging, and the tab order updates after dropping', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Meta+t');
    await ensureTabsOpen(page);

    const before = await tabOrder(page);
    expect(before.length).toBeGreaterThanOrEqual(2);
    const first = before[0]!;
    const last = before[before.length - 1]!;
    expect(first).not.toBe(last);

    await startDragRow(page, `tab-row-${first}`, `tab-row-${last}`, 0.85);
    await expect(page.locator(`[data-testid="tab-row-${first}"]`)).toHaveAttribute('data-reorder-dragging', 'true');
    await expect(page.locator('[data-reorder-placeholder]')).toHaveCount(1);
    await page.mouse.up();

    const after = await tabOrder(page);
    expect(after[after.length - 1]).toBe(first);
    expect(after.slice(0, -1)).toEqual(before.slice(1));
  });

  test('dragging a tab into a group and reordering within it: the open slot always appears inside the group', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Meta+t');
    await ensureTabsOpen(page);

    const tabs = await tabOrder(page);
    expect(tabs.length).toBeGreaterThanOrEqual(2);
    const [a, b] = tabs as [string, string];

    // Right-click a to create a group: a joins the group while b stays ungrouped
    await page.getByTestId(`tab-row-${a}`).click({ button: 'right' });
    await page.getByRole('button', { name: '新建分组', exact: true }).click();
    await page.keyboard.press('Escape');
    const group = page.locator('[data-group-id]').first();
    await expect(group).toBeVisible();

    // Drag ungrouped b onto a inside the group: the slot appears inside the group, not at the nearest row in the list
    // The leading-edge decision uses the ideal position after removing the source tab, so sweep in from the right until a placeholder appears inside the group.
    const dragUntilGroupPlaceholder = async (sourceId: string, memberId: string) => {
      const source = (await page.getByTestId(`tab-row-${sourceId}`).boundingBox())!;
      const y = source.y + source.height / 2;
      await page.mouse.move(source.x + 4, y);
      await page.mouse.down();
      await page.mouse.move(source.x + 24, y, { steps: 2 });
      const member = (await page.getByTestId(`tab-row-${memberId}`).boundingBox())!;
      for (let x = member.x + member.width + 60; x > 240; x -= 10) {
        await page.mouse.move(x, y);
        if (await group.locator('[data-reorder-placeholder]').count() > 0) return;
      }
    };
    await dragUntilGroupPlaceholder(b, a);
    await expect(group.locator('[data-reorder-placeholder]')).toHaveCount(1);
    await page.mouse.up();
    await expect(group.locator(`[data-testid="tab-row-${b}"]`)).toHaveAttribute('data-tab-group', /.+/);

    // Reorder within the group: drag a onto b in the group; the slot also appears inside the group
    await dragUntilGroupPlaceholder(a, b);
    await expect(group.locator('[data-reorder-placeholder]')).toHaveCount(1);
    await page.mouse.up();

    // The group tab's context menu can move it out explicitly (no need to drag it to the "ungrouped" area)
    await group.locator(`[data-testid="tab-row-${b}"]`).click({ button: 'right' });
    await page.getByRole('button', { name: '移出分组', exact: true }).click();
    await expect(group.locator(`[data-testid="tab-row-${b}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-testid="tab-row-${b}"][data-tab-group=""]`)).toHaveCount(1);
  });
});
