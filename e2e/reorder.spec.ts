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

test.describe('侧栏列表拖拽排序', () => {
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
        const groupId = await store.createGroupForTab(first, 'Regression group');
        useWorkspaceStore.getState().moveTab(second, groupId, 1);
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
  test('SSH 连接：拖动时源行让位并出现虚线占位，落下后顺序持久化', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await page.locator('[data-dock-btn="ssh"]').click();
    await expect(page.locator('[data-testid="ssh-search"]')).toBeVisible();

    // mock 默认只有一条连接：再造一条用于排序
    await page.locator('[data-testid="ssh-new-btn"]').click();
    await page.locator('[data-testid="ssh-form-name"]').fill('备用机');
    await page.locator('[data-testid="ssh-form-host"]').fill('backup.example.com');
    await page.locator('[data-testid="ssh-save-btn"]').click();
    await expect(page.getByText('备用机')).toBeVisible();

    const before = await sshOrder(page);
    expect(before).toHaveLength(2);
    const [first, second] = before as [string, string];

    await startDragRow(page, `ssh-row-${first}`, `ssh-row-${second}`, 0.85);
    // 拖动中：源行让位（隐藏），落点用虚线占位
    await expect(page.locator(`[data-testid="ssh-row-${first}"]`)).toHaveAttribute('data-reorder-dragging', 'true');
    await expect(page.locator('[data-reorder-placeholder]')).toHaveCount(1);
    await page.mouse.up();

    expect(await sshOrder(page)).toEqual([second, first]);
    // 新顺序写入本地存储（store 的 load 会按它排列，单测覆盖该路径）
    const stored = await page.evaluate(() => localStorage.getItem('vrykell-ssh-order'));
    expect(JSON.parse(stored ?? 'null')).toEqual([second, first]);
  });

  test('标签页：拖动让位 + 占位，落下后标签顺序更新', async ({ page }) => {
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

  test('标签拖入分组与组内换序：空位都出现在组内', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Meta+t');
    await ensureTabsOpen(page);

    const tabs = await tabOrder(page);
    expect(tabs.length).toBeGreaterThanOrEqual(2);
    const [a, b] = tabs as [string, string];

    // 在 a 上右键新建分组：a 进组，b 仍是未分组
    await page.getByTestId(`tab-row-${a}`).click({ button: 'right' });
    await page.getByRole('button', { name: '新建分组', exact: true }).click();
    await page.keyboard.press('Escape');
    const group = page.locator('[data-group-id]').first();
    await expect(group).toBeVisible();

    // 把未分组的 b 拖到组内 a 上：空位出现在组内，而不是列表里最近的行
    // 前缘判定按“移除源标签后的理想位置”计算，因此从右侧扫动，直到组内出现占位。
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

    // 组内换序：a 拖到组内 b 上，空位同样在组内出现
    await dragUntilGroupPlaceholder(a, b);
    await expect(group.locator('[data-reorder-placeholder]')).toHaveCount(1);
    await page.mouse.up();

    // 组内标签的右键菜单可以显式移出分组（不必非要拖到「未分组」区）
    await group.locator(`[data-testid="tab-row-${b}"]`).click({ button: 'right' });
    await page.getByRole('button', { name: '移出分组', exact: true }).click();
    await expect(group.locator(`[data-testid="tab-row-${b}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-testid="tab-row-${b}"][data-tab-group=""]`)).toHaveCount(1);
  });
});
