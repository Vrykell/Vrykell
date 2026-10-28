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
  // Hover the right half to preview the placement, then click to confirm.
  const point = await hoverPlacementZone(page, focusedPane(page), 'right');
  await expect(page.getByTestId('placement-zone-1')).toBeVisible();
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('.terminal-pane:visible')).toHaveCount(2);
});

/**
 * Keep-alive across drag reordering: after dragging a pane changes the layout structure
 * (removeLeaf + splitLeaf) the running block's PTY must stay alive — regression for running
 * content exiting as soon as a terminal or tab is dragged.
 * Flat rendering keys by terminal id, so reordering only changes geometry and does not remount
 * TerminalPane.
 *
 * Note: the mock event system has a single listener (later registrations overwrite earlier ones
 * in the eventListeners map), so the running block only appears in the pane split last (the drag
 * target in this test).
 */
test('drag reordering keeps the running block PTY alive without remounting or exiting the command', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });

  // Split out a second terminal (click the right-half zone); the pane split last owns the running block.
  await page.keyboard.press('Meta+d');
  await expect(page.getByTestId('placement-overlay')).toBeVisible({ timeout: 5000 });
  await pickPlacementZone(page, focusedPane(page), 'right');
  const panes = page.locator('.terminal-pane:visible');
  await expect(panes).toHaveCount(2);

  // Start a long-running command (single listener, so only the pane split last enters execution).
  await emitPtyOutput(page, `\x1b]133;E;${btoa('sleep 100')}\x07\x1b]133;C\x07`);
  await expect(page.locator('[data-tip="终止命令"]')).toHaveCount(1, { timeout: 5000 });

  // Emit a marker line to confirm the running block is rendering.
  await emitPtyOutput(page, 'keep-alive-marker\r\n');
  await expectAnyTermContains(page, 'keep-alive-marker', 3000);

  // Drag the first pane (left, empty) onto the right half: the layout restructures and the pane holding the running block moves.
  const first = await panes.first().boundingBox();
  expect(first).not.toBeNull();
  await page.mouse.move(first!.x + first!.width * 0.5, first!.y + first!.height * 0.5);
  await page.mouse.down();
  // Cross the 5px threshold to start dragging, then move to the target (center of the right half).
  await page.mouse.move(first!.x + first!.width * 0.5 + 50, first!.y + first!.height * 0.5, { steps: 5 });
  const vp = page.viewportSize()!;
  await page.mouse.move(vp.width * 0.75, vp.height * 0.5, { steps: 10 });
  // While dragging only the placement preview under the pointer is shown (no text).
  await expect(page.getByTestId('move-placement-zone-1')).toBeVisible();
  await page.mouse.up();

  // After reordering the running block is still alive (PTY not exited, block not remounted, content not lost).
  await expect(page.locator('[data-tip="终止命令"]')).toHaveCount(1, { timeout: 5000 });
  await expectAnyTermContains(page, 'keep-alive-marker', 3000);
});

test('reposition pane: hover a target zone and click to move the pane', async ({ page }) => {
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

test('a single terminal disables reposition while split remains available', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await page.locator('.terminal-pane:visible').first().click({ button: 'right' });
  await expect(page.getByRole('button', { name: '更换窗格位置', exact: true })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: '拆分标签页', exact: true })).toBeVisible();
  await expect(page.getByTestId('placement-overlay')).toHaveCount(0);
});
