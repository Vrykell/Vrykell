import { expect, test } from '@playwright/test';
import { emitPtyOutput, ptyWrites, setupTauriMock } from './tauri-mock';

for (const surface of ['block', 'manual-fullscreen', 'alternate-screen'] as const) {
  test(`stops queued paste when the foreground exits from ${surface}`, async ({ page }) => {
    await setupTauriMock(page); await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
    await page.waitForFunction(async () => {
      const path = '/src/features/terminal/stores/terminal.ts';
      const { useTerminalStore } = await import(path) as typeof import('../src/features/terminal/stores/terminal');
      return Object.values(useTerminalStore.getState().startupStates).includes('ready');
    });
    await emitPtyOutput(page, '\x1b]133;E;YXBwbGljYXRpb24=\x07\x1b]133;C\x07running');
    await expect(page.getByTestId('running-term')).toBeVisible();
    if (surface === 'alternate-screen') {
      await emitPtyOutput(page, '\x1b[?1049hTUI');
      await expect(page.getByTestId('tui-banner')).toBeVisible();
    } else if (surface === 'manual-fullscreen') {
      await page.locator('[data-testid^="running-block-"]').first().hover();
      await page.locator('[data-tip="进入全屏交互"]').click();
      await expect(page.getByTestId('tui-fullscreen')).toBeVisible();
    }
    await page.evaluate(surface => {
      const host = window as unknown as { __CLIPBOARD_TEXT__: string; __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>; emitPtyOutput: (data: string) => void } };
      host.__CLIPBOARD_TEXT__ = `${'x'.repeat(8192)}\necho UNINTENDED_EXECUTION\n`;
      const original = host.__TAURI_INTERNALS__.invoke; let ended = false;
      host.__TAURI_INTERNALS__.invoke = async (command, args) => {
        const result = await original(command, args);
        if (command === 'pty_write' && args?.expectedEpoch !== undefined && !ended) {
          ended = true;
          host.__TAURI_INTERNALS__.emitPtyOutput(`${surface === 'alternate-screen' ? '\x1b[?1049l' : ''}\x1b]133;D;0\x07\x1b]133;A\x07\x1b]133;B\x07`);
        }
        return result;
      };
    }, surface);
    const before = (await ptyWrites(page)).length;
    const input = surface === 'block' ? page.getByTestId('running-term').locator('.xterm-helper-textarea')
      : surface === 'manual-fullscreen' ? page.getByTestId('tui-fullscreen').locator('.xterm-helper-textarea')
        : page.locator('.terminal-pane:visible .xterm-helper-textarea').first();
    await input.press('Control+v');
    await expect(page.getByTestId('confirm-dialog')).toBeVisible();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByRole('status')).toContainText('粘贴已停止');
    const writes = (await ptyWrites(page)).slice(before);
    expect(writes).toHaveLength(1); expect(writes[0]).toHaveLength(1024);
    expect(writes.join('')).not.toContain('UNINTENDED_EXECUTION');
    await expect(page.locator('[data-terminal-input]:visible')).toBeVisible();
    await page.locator('[data-terminal-input]:visible').fill('intentional next command');
    expect((await ptyWrites(page)).slice(before)).toEqual(writes);
  });
}
