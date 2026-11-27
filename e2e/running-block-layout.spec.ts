import { expect, test, type Page } from '@playwright/test';
import { setupTauriMock, emitPtyOutput, ptyResizes, ptyWrites } from './tauri-mock';

async function openRunning(page: Page, remote = false) {
  await setupTauriMock(page);
  if (remote)
    await page.addInitScript(() =>
      localStorage.setItem(
        'vrykell-agent-settings',
        JSON.stringify({ version: 8, state: { global: { sshOpenMode: 'block' }, overrides: {} } }),
      ),
    );
  await page.goto('/');
  if (remote) {
    await page.locator('[data-dock-btn="ssh"]').click();
    await page.getByTestId('ssh-row-ssh-1').dblclick();
    await expect(page.getByTestId('ssh-connection-input')).toBeHidden();
  }
  await expect(page.locator('[data-terminal-input]:visible')).toBeVisible();
  await page.waitForFunction(async () => {
    const path = '/src/features/terminal/stores/terminal.ts';
    const { useTerminalStore } = (await import(path)) as typeof import('../src/features/terminal/stores/terminal');
    return Object.values(useTerminalStore.getState().startupStates).includes('ready');
  });
  await emitPtyOutput(page, `\x1b]133;E;${btoa('tail -f live.log')}\x07\x1b]133;C\x07${'live output '.repeat(60)}\r\n`);
  await expect(page.getByTestId('running-term').locator('.xterm-screen')).toBeVisible();
}

async function grid(page: Page) {
  return page.getByTestId('running-term').evaluate((host) => {
    const terms = (window as unknown as { __vrykellTerms: Map<string, import('@xterm/xterm').Terminal> }).__vrykellTerms;
    const term = [...terms.entries()].find(([key]) => key.startsWith('block:'))![1];
    const width = host.querySelector('.xterm-screen')!.getBoundingClientRect().width;
    const buffer = term.buffer.active;
    let longest = 0;
    for (let i = 0; i < buffer.length; i++) longest = Math.max(longest, buffer.getLine(i)?.translateToString(true).length ?? 0);
    return { cols: term.cols, rows: term.rows, width, available: host.clientWidth, cell: width / term.cols, longest };
  });
}

for (const density of [1, 1.25])
  test.describe(`running layout at ${density}x`, () => {
    test.use({ deviceScaleFactor: density });

    test('SSH live output reflows while the authentication screen is hidden', async ({ page }, info) => {
      await openRunning(page, true);
      await emitPtyOutput(page, `RESIZE_LOG:${'0123456789'.repeat(110)}:END\r\n`);
      for (const width of [900, 1500, 760, 1240]) {
        await page.setViewportSize({ width, height: 800 });
        await expect(async () => {
          const size = await grid(page);
          expect(size.width).toBeLessThanOrEqual(size.available + 1);
          expect(size.available - size.width).toBeLessThan(size.cell + 1);
          expect(size.longest).toBe(size.cols);
          expect((await ptyResizes(page)).at(-1)).toMatchObject({ cols: size.cols, rows: size.rows });
        }).toPass({ timeout: 5000 });
        if (width === 760 || width === 1500) await page.screenshot({ path: info.outputPath(`ssh-running-${width}.png`) });
      }
      const before = await grid(page);
      await page.locator('[data-dock-btn="files"]').click();
      const handle = (await page.getByTestId('resize-handle-files').boundingBox())!;
      await page.mouse.move(handle.x + handle.width / 2, handle.y + 140);
      await page.mouse.down();
      try {
        await page.mouse.move(handle.x + handle.width / 2 - 110, handle.y + 140, { steps: 12 });
        await expect(async () => {
          const size = await grid(page);
          expect(size.cols).toBeLessThan(before.cols);
          expect(size.available - size.width).toBeLessThan(size.cell + 1);
          expect((await ptyResizes(page)).at(-1)?.cols).toBe(size.cols);
        }).toPass();
      } finally {
        await page.mouse.up();
      }
    });

    test('window width changes resize the live grid and PTY without additional output', async ({ page }, info) => {
      await openRunning(page);
      for (const width of [900, 1500, 760, 1240]) {
        await page.setViewportSize({ width, height: 800 });
        await expect(async () => {
          const size = await grid(page);
          expect(size.width).toBeLessThanOrEqual(size.available + 1);
          expect(size.available - size.width).toBeLessThan(size.cell + 1);
          expect((await ptyResizes(page)).at(-1)).toMatchObject({ cols: size.cols, rows: size.rows });
        }).toPass();
        if (width === 760 || width === 1500) await page.screenshot({ path: info.outputPath(`running-${width}.png`) });
      }
    });

    test('a held sidebar drag delivers the running program its new size before release', async ({ page }) => {
      await openRunning(page);
      const before = await grid(page);
      await page.locator('[data-dock-btn="files"]').click();
      const handle = (await page.getByTestId('resize-handle-files').boundingBox())!;
      await page.mouse.move(handle.x + handle.width / 2, handle.y + 140);
      await page.mouse.down();
      try {
        await page.mouse.move(handle.x + handle.width / 2 - 110, handle.y + 140, { steps: 12 });
        await expect(async () => {
          const size = await grid(page);
          expect(size.cols).toBeLessThan(before.cols);
          expect((await ptyResizes(page)).at(-1)?.cols).toBe(size.cols);
          expect(size.available - size.width).toBeLessThan(size.cell + 1);
        }).toPass();
        expect(
          await page.evaluate(async () => {
            const path = '/src/ui/layout/layoutResizeDrag.ts';
            const { isLayoutResizeDragActive } = (await import(path)) as typeof import('@ui/layout/layoutResizeDrag');
            return isLayoutResizeDragActive();
          }),
        ).toBe(true);
      } finally {
        await page.mouse.up();
      }
      await expect(async () => expect((await ptyResizes(page)).at(-1)?.cols).toBe((await grid(page)).cols)).toPass();
    });

    test('running controls stay in the command block when its header scrolls away', async ({ page }, info) => {
      await openRunning(page);
      await emitPtyOutput(page, 'log entry\r\n'.repeat(160));
      const scroll = page.locator('[data-testid^="terminal-scroll-"]').first();
      const row = scroll.locator('[data-running="true"] .command-block-info');
      for (const width of [1240, 760]) {
        await page.setViewportSize({ width, height: 700 });
        await expect(row).toHaveCount(1);
        await scroll.evaluate((element) => {
          element.scrollTop = 0;
        });
        await expect(row).toBeInViewport();
        await scroll.evaluate((element) => {
          const header = element.querySelector<HTMLElement>('[data-running="true"] .command-block-info')!;
          element.scrollTop += header.getBoundingClientRect().bottom - element.getBoundingClientRect().top + 20;
        });
        await expect(row).not.toBeInViewport();
        await expect(page.getByTestId('pinned-command')).toHaveCount(0);
        await page.screenshot({ path: info.outputPath(`unobstructed-running-${width}.png`) });
      }
      await scroll.evaluate((element) => {
        element.scrollTop = 0;
      });
      await row.hover();
      const before = (await ptyWrites(page)).length;
      await row.getByRole('button', { name: '终止命令', exact: true }).click();
      await expect.poll(async () => (await ptyWrites(page)).slice(before)).toEqual(['\x03']);
      await row.getByRole('button', { name: '进入全屏交互', exact: true }).click();
      await expect(page.getByTestId('tui-fullscreen')).toBeVisible();
    });
  });
