import { test, expect, type Page } from '@playwright/test';
import { setupTauriMock, ensureTabsOpen } from './tauri-mock';

/** Press the pointer on a row and drag it onto `ratio` of the target row (mouse stays down). */
async function startDragRow(page: Page, sourceTestId: string, targetTestId: string, ratio = 0.8) {
  const from = (await page.getByTestId(sourceTestId).boundingBox())!;
  await page.mouse.move(from.x + 40, from.y + from.height / 2);
  await page.mouse.down();
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    const target = (await page.getByTestId(targetTestId).boundingBox())!;
    const toX = target.x + 40;
    const toY = target.y + target.height * ratio;
    await page.mouse.move(
      from.x + 40 + (toX - (from.x + 40)) * (i / steps),
      from.y + from.height / 2 + (toY - (from.y + from.height / 2)) * (i / steps),
    );
    await page.waitForTimeout(12);
  }
}

const sshOrder = (page: Page) =>
  page.locator('[data-reorder-item][data-reorder-kind="ssh"]')
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.reorderItem));

const tabOrder = (page: Page) =>
  page.locator('[data-reorder-item][data-reorder-kind="tab"]')
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.reorderItem));

test.describe('侧栏列表拖拽排序', () => {
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
});
