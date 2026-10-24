import { expect, test } from '@playwright/test';
import { emitPtyOutput, setupTauriMock } from './tauri-mock';
import { pickPlacementZone } from './placement';

for (const manual of [false, true]) test(`split and relocation retain the live ${manual ? 'manual fullscreen' : 'alternate-screen'} session and frame`, async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  const paneId = await page.evaluate(async () => {
    const path = '/src/features/terminal/stores/terminal.ts';
    const { useTerminalStore } = await import(path) as typeof import('../src/features/terminal/stores/terminal');
    return Object.keys(useTerminalStore.getState().sessions)[0]!;
  });
  await page.waitForFunction(async id => {
    const path = '/src/features/terminal/stores/terminal.ts';
    const { useTerminalStore } = await import(path) as typeof import('../src/features/terminal/stores/terminal');
    return useTerminalStore.getState().startupStates[id] === 'ready';
  }, paneId);
  await page.evaluate(id => {
    const globals = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (command: string, args: Record<string, unknown>) => Promise<unknown> };
      __PTY_SPAWNS__: Record<string, unknown>[];
      __PTY_CLOSES__: Record<string, unknown>[];
      __vrykellTerms: Map<string, unknown>;
      __initialTerm?: unknown;
    };
    globals.__initialTerm = globals.__vrykellTerms.get(id);
    globals.__PTY_SPAWNS__.length = 0;
    globals.__PTY_CLOSES__.length = 0;
    const invoke = globals.__TAURI_INTERNALS__.invoke;
    let counter = 0;
    globals.__TAURI_INTERNALS__.invoke = (command, args) => {
      if (command === 'pty_spawn') {
        globals.__PTY_SPAWNS__.push(args);
        return Promise.resolve(`layout-session-${counter++}`);
      }
      return invoke(command, args);
    };
  }, paneId);
  await emitPtyOutput(page, `\x1b]133;E;dmlt\x07\x1b]133;C\x07${manual ? '' : '\x1b[?1049h'}\x1b[2J\x1b[Hretained TUI frame`);
  const originalPane = page.getByTestId(`pane-${paneId}`);
  if (manual) {
    await expect(originalPane.getByTestId('running-term').locator('.xterm')).toBeVisible();
    await originalPane.locator('[data-running="true"]').hover();
    await originalPane.getByRole('button', { name: '进入全屏交互', exact: true }).click();
    await expect(page.getByTestId('tui-fullscreen')).toBeVisible();
    await page.evaluate(id => {
      const globals = window as unknown as { __vrykellTerms: Map<string, unknown>; __initialTerm?: unknown };
      globals.__initialTerm = globals.__vrykellTerms.get(`block:${id}`);
    }, paneId);
  } else await expect(originalPane.getByTestId('tui-banner')).toBeVisible();
  const preserved = async (newSessions: number) => {
    await expect.poll(() => page.evaluate(id => {
      const globals = window as unknown as {
        __PTY_SPAWNS__: unknown[]; __PTY_CLOSES__: unknown[];
        __initialTerm?: unknown;
        __vrykellTerms: Map<string, { buffer: { active: { type: string; getLine: (line: number) => { translateToString: () => string } | undefined } } }>;
      };
      const term = globals.__vrykellTerms.get(id)!;
      return { same: term === globals.__initialTerm, buffer: term.buffer.active.type,
        frame: term.buffer.active.getLine(0)?.translateToString().trim(),
        spawns: globals.__PTY_SPAWNS__.length, closes: globals.__PTY_CLOSES__.length };
    }, manual ? `block:${paneId}` : paneId)).toEqual({ same: true, buffer: manual ? 'normal' : 'alternate', frame: 'retained TUI frame', spawns: newSessions, closes: 0 });
    if (manual && await page.getByTestId('tui-fullscreen').count()) {
      await expect(page.getByTestId('tui-fullscreen').locator('.xterm')).toBeVisible();
    } else await expect(originalPane.getByTestId(manual ? 'running-term' : 'tui-banner')).toBeVisible();
  };
  await page.keyboard.press('Meta+d');
  await pickPlacementZone(page, originalPane, 'left');
  await expect(page.locator('.terminal-pane:visible')).toHaveCount(2);
  await preserved(1);
  await originalPane.click({ button: 'right', position: { x: 16, y: 12 } });
  await page.getByRole('button', { name: '更换位置', exact: true }).click();
  await expect(page.getByTestId('placement-overlay')).toBeVisible();
  await pickPlacementZone(page, page.locator('.terminal-pane:visible').first(), 'bottom');
  await preserved(1);
  if (manual) await page.getByTestId('tui-fullscreen').getByRole('button', { name: '退出全屏', exact: true }).click();
  const divider = page.getByTestId('terminal-divider-col');
  await expect(divider).toBeVisible();
  const bounds = (await divider.boundingBox())!;
  await page.mouse.move(bounds.x + 40, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 40, bounds.y + 40, { steps: 6 });
  await page.mouse.up();
  await preserved(1);
  await page.screenshot({ path: test.info().outputPath('retained-tui-layout.png') });
});
