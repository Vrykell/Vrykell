import { test, expect } from '@playwright/test';
import { setupTauriMock, fsOps } from './tauri-mock';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  // 打开文件面板
  await page.locator('[data-dock-btn="files"]').click();
  await expect(page.getByText('Documents')).toBeVisible({ timeout: 3000 });
});

test.describe('文件面板', () => {
  test('文件项可点击且面板保持打开', async ({ page }) => {
    // 单击文件默认新建标签页打开（标签页意义已泛化），文件面板保持打开
    await expect(page.getByText('Documents')).toBeVisible();
    await page.getByText('notes.txt').click();
    await expect(page.getByText('Documents')).toBeVisible();
  });

  test('单击目录原地展开，双击进入并显示返回按钮', async ({ page }) => {
    // 单击 = 树形展开（mock 对每个路径返回相同子项，展开后 Documents 出现两个）
    await page.getByText('Documents').click();
    await expect(page.getByText('Documents')).toHaveCount(2);
    // 双击 = 进入文件夹，出现返回按钮
    await page.getByText('Documents').first().dblclick();
    await expect(page.getByText('‹ 返回')).toBeVisible();
  });

  test('关闭面板再重新打开', async ({ page }) => {
    // 关闭面板——再点一次 dock 按钮
    await page.locator('[data-dock-btn="files"]').click();
    await expect(page.getByText('Documents')).toHaveCount(0);
    // 重新打开
    await page.locator('[data-dock-btn="files"]').click();
    await expect(page.getByText('Documents')).toBeVisible({ timeout: 3000 });
  });

  test('拖拽到最小宽度立即折叠；松手前可反悔拖回', async ({ page }) => {
    await expect(page.getByText('Documents')).toBeVisible();
    // 向右拖手柄 = 面板变窄（files 在右栏，手柄在左缘；默认宽 240 → 下限 160 需拖 80px）
    const handle = page.locator('[data-testid="resize-handle-files"]');
    await expect(handle).toBeVisible();
    const box = await handle.boundingBox();
    const cy = (box?.y ?? 0) + (box?.height ?? 0) / 2;
    const cx = (box?.x ?? 0) + (box?.width ?? 0) / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    // 第 5 步（80px）到下限 → 立即折叠，之后保持收起
    for (let i = 0; i < 8; i++) {
      await page.mouse.move(cx + (i + 1) * 16, cy);
      await page.waitForTimeout(12);
      if (i >= 5) {
        await expect(page.getByText('Documents')).toHaveCount(0);
      }
    }
    // 松手前反悔：向左拖回 → 面板恢复
    for (let i = 0; i < 8; i++) {
      await page.mouse.move(cx + (8 - i) * 16, cy);
      await page.waitForTimeout(12);
    }
    await expect(page.getByText('Documents')).toBeVisible({ timeout: 3000 });
    // 松手定局：保持展开
    await page.mouse.up();
    await expect(page.getByText('Documents')).toBeVisible();
    // 再拖到折叠并直接松手 → 折叠保持；点 Dock 按钮恢复
    // （宽度已变，手柄位置随之移动，需重新定位）
    const box2 = await handle.boundingBox();
    const cx2 = (box2?.x ?? 0) + (box2?.width ?? 0) / 2;
    await page.mouse.move(cx2, cy);
    await page.mouse.down();
    for (let i = 0; i < 8; i++) {
      await page.mouse.move(cx2 + (i + 1) * 16, cy);
      await page.waitForTimeout(12);
    }
    await page.mouse.up();
    await expect(page.getByText('Documents')).toHaveCount(0);
    await page.locator('[data-dock-btn="files"]').click();
    await expect(page.getByText('Documents')).toBeVisible({ timeout: 3000 });
  });

  test('删除文件需二次确认，确认后调用后端删除（回收站）', async ({ page }) => {
    await page.getByText('notes.txt').click({ button: 'right' });
    await page.getByRole('button', { name: '删除' }).click();
    await expect(page.locator('[data-testid="confirm-dialog"]')).toBeVisible();
    await expect(page.getByText('确认删除')).toBeVisible();
    await page.locator('[data-testid="confirm-ok"]').click();
    const ops = await fsOps(page);
    expect(ops).toContainEqual({ op: 'delete', path: '/home/e2e/notes.txt' });
  });

  test('重命名为侧栏内联编辑，回车后确认', async ({ page }) => {
    await page.getByText('notes.txt').click({ button: 'right' });
    await page.getByRole('button', { name: '重命名' }).click();
    // 内联输入框出现，而非弹窗
    const input = page.locator('[data-testid="rename-input"]');
    await expect(input).toBeVisible();
    await expect(page.locator('[data-testid="prompt-input"]')).toHaveCount(0);
    await input.fill('renamed.txt');
    await input.press('Enter');
    await expect(page.locator('[data-testid="confirm-dialog"]')).toBeVisible();
    await expect(page.getByText('确认重命名')).toBeVisible();
    await page.locator('[data-testid="confirm-ok"]').click();
    const ops = await fsOps(page);
    expect(ops).toContainEqual({ op: 'rename', path: '/home/e2e/notes.txt', newName: 'renamed.txt' });
  });
});
