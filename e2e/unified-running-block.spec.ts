import { expect, test } from '@playwright/test';
import { emitPtyOutput, ptyWrites, setupTauriMock } from './tauri-mock';

test('routes input and manual fullscreen to a running block placed in the unified workspace', async ({ page }) => {
  await setupTauriMock(page, { schedulesSeed: [] });
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await page.waitForFunction(async () => {
    const path = '/src/features/terminal/stores/terminal.ts';
    const { useTerminalStore } = await import(path) as typeof import('../src/features/terminal/stores/terminal');
    return Object.values(useTerminalStore.getState().startupStates).includes('ready');
  });
  await emitPtyOutput(page, `\x1b]133;E;${btoa('sleep 100')}\x07\x1b]133;C\x07`);
  await expect(page.getByTestId('running-term').locator('.xterm')).toBeVisible();

  await page.getByTestId('workspace-area-unified').click();
  const workspace = page.getByTestId('unified-workspace');
  await page.getByTestId('workspace-instance-bar').getByRole('tab').nth(0).click();
  const pane = workspace.locator('.unified-pane').filter({ has: page.locator('.terminal-pane') }).first();
  await expect(pane.locator('.terminal-pane')).toBeVisible();
  await pane.click({ position: { x: 120, y: 220 } });

  // The running block owns keyboard input while focus sits on its unified pane.
  const typed = (await ptyWrites(page)).length;
  await page.keyboard.type('x');
  await expect.poll(async () => (await ptyWrites(page)).slice(typed)).toEqual(['x']);

  // Its fullscreen surface lives inside the placed pane instead of the hidden native host.
  await pane.locator('[data-testid^="running-block-"]').first().hover();
  await pane.locator('[data-tip="进入全屏交互"]').click();
  const fullscreen = pane.getByTestId('tui-fullscreen');
  await expect(fullscreen).toBeVisible();
  await expect(fullscreen.locator('.xterm-screen')).toBeVisible();
  await expect(fullscreen.locator('textarea')).toBeFocused();
  const fullscreenTyped = (await ptyWrites(page)).length;
  await page.keyboard.type('y');
  await expect.poll(async () => (await ptyWrites(page)).slice(fullscreenTyped)).toEqual(['y']);

  // Returning to the native terminal area keeps the same fullscreen surface interactive.
  await page.getByTestId('workspace-area-terminal').click();
  await expect(page.getByTestId('tui-fullscreen').locator('.xterm-screen')).toBeVisible();
  await expect(page.getByTestId('tui-fullscreen').locator('textarea')).toBeFocused();
  const nativeTyped = (await ptyWrites(page)).length;
  await page.keyboard.type('z');
  await expect.poll(async () => (await ptyWrites(page)).slice(nativeTyped)).toEqual(['z']);
  await page.locator('[data-tip="退出全屏"]').click();
  await expect(page.getByTestId('tui-fullscreen')).toHaveCount(0);
  await expect(page.locator('.terminal-pane .xterm-screen').first()).toBeVisible();
});
