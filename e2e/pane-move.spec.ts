import { test, expect } from '@playwright/test';
import { setupTauriMock, emitPtyOutput, expectAnyTermContains } from './tauri-mock';
import { focusedPane, hoverPlacementZone, pickPlacementZone } from './placement';

test('a single pane ignores reordering gestures and remains ready for splitting', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  const pane = await page.locator('.terminal-pane:visible').boundingBox();
  await page.mouse.move(pane!.x + pane!.width / 2, pane!.y + 100);
  await page.mouse.down();
  await page.mouse.move(pane!.x + pane!.width / 2 + 50, pane!.y + 100);
  await page.mouse.up();
  await page.keyboard.press('Meta+d');
  // 悬停右半屏预览该落点后点击确认
  const point = await hoverPlacementZone(page, focusedPane(page), 'right');
  await expect(page.getByTestId('placement-zone-1')).toBeVisible();
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('.terminal-pane:visible')).toHaveCount(2);
});

/**
 * 拖动终端重排保活：拖拽 pane 改变布局结构（removeLeaf + splitLeaf）后，
 * 运行中块的 PTY 必须存活 —— 回归「拖拽终端/标签时运行中内容立刻退出」。
 * 平面渲染按终端 id 作 key，重排只改几何、不重挂 TerminalPane。
 *
 * 注：mock 的事件系统为单监听（eventListeners Map 后注册覆盖前者），
 * 运行中块只会出现在后分裂出的那个 pane（本测试即被拖动的目标 pane）。
 */
test('拖动终端重排：运行中块的 PTY 保活（不重挂、命令不退出）', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });

  // 分裂出第二个终端（点右半屏落点）；后分裂的 pane 持有运行中块
  await page.keyboard.press('Meta+d');
  await expect(page.getByTestId('placement-overlay')).toBeVisible({ timeout: 5000 });
  await pickPlacementZone(page, focusedPane(page), 'right');
  const panes = page.locator('.terminal-pane:visible');
  await expect(panes).toHaveCount(2);

  // 启动长时间运行命令（单监听 → 只有后分裂 pane 进入执行）
  await emitPtyOutput(page, `\x1b]133;E;${btoa('sleep 100')}\x07\x1b]133;C\x07`);
  await expect(page.locator('[data-tip="终止命令"]')).toHaveCount(1, { timeout: 5000 });

  // 输出标记行，确认运行中块在渲染
  await emitPtyOutput(page, 'keep-alive-marker\r\n');
  await expectAnyTermContains(page, 'keep-alive-marker', 3000);

  // 拖动第一个 pane（左半，空）到右半屏：布局结构重排，持有运行块的 pane 移位
  const first = await panes.first().boundingBox();
  expect(first).not.toBeNull();
  await page.mouse.move(first!.x + first!.width * 0.5, first!.y + first!.height * 0.5);
  await page.mouse.down();
  // 超过 5px 阈值进入拖动，再移到目标落点（右半屏中心）
  await page.mouse.move(first!.x + first!.width * 0.5 + 50, first!.y + first!.height * 0.5, { steps: 5 });
  const vp = page.viewportSize()!;
  await page.mouse.move(vp.width * 0.75, vp.height * 0.5, { steps: 10 });
  // 拖动中只显示指针下的落点预览（无文字）
  await expect(page.getByTestId('move-placement-zone-1')).toBeVisible();
  await page.mouse.up();

  // 布局重排后：运行中块仍活着（PTY 未退出、块未重挂、内容未丢失）
  await expect(page.locator('[data-tip="终止命令"]')).toHaveCount(1, { timeout: 5000 });
  await expectAnyTermContains(page, 'keep-alive-marker', 3000);
});

test('更换窗格位置：悬停目标落点后点击即可移动窗格', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await page.keyboard.press('Meta+d');
  await pickPlacementZone(page, focusedPane(page), 'right');
  const panes = page.locator('.terminal-pane:visible');
  await expect(panes).toHaveCount(2);

  // Right-click the first pane and choose reposition; the moving pane is absent from its targets.
  const movedId = await panes.first().getAttribute('data-testid');
  await panes.first().click({ button: 'right' });
  await page.getByRole('button', { name: '更换窗格位置', exact: true }).click();
  await expect(page.getByTestId('placement-overlay')).toBeVisible();
  await pickPlacementZone(page, panes.first(), 'bottom');

  // The original pane moves below and keeps focus.
  const moved = (await page.locator(`[data-testid="${movedId}"]`).boundingBox())!;
  const other = (await panes.first().boundingBox())!;
  expect(moved.y).toBeGreaterThan(other.y);
  await expect(page.locator(`[data-testid="${movedId}"]`)).toHaveAttribute('data-focused', 'true');
});

test('a single terminal omits reposition while split remains available', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await page.locator('.terminal-pane:visible').first().click({ button: 'right' });
  await expect(page.getByRole('button', { name: '更换窗格位置', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '拆分标签页', exact: true })).toBeVisible();
  await expect(page.getByTestId('placement-overlay')).toHaveCount(0);
});
