import { test, expect } from '@playwright/test';
import { setupTauriMock, emitPtyOutput, ptyWrites, ptySignals, expectAnyTermContains } from './tauri-mock';

test.describe('Command blocks (OSC 133)', () => {
  test('the block UI is visible after running a command in the terminal', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    // The initial prompt enters the blockList scene
    const input = page.getByPlaceholder(/输入命令/);
    await expect(input).toBeVisible({ timeout: 5000 });

    await input.fill('echo e2e-block-test');
    await input.press('Enter');

    // The block shows the command text (bold, without a $ prefix) and the output text
    await expect(page.getByText('echo e2e-block-test').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('e2e-block-test').first()).toBeVisible({ timeout: 5000 });
    // Context row: exit code 0
    await expect(page.getByTestId('exit-code').first()).toHaveText('0', { timeout: 5000 });
  });

  test('without OSC 133: block mode stages output while classic open mode writes straight to xterm', async ({ page }) => {
    // Disable shell integration: the default open mode is block mode, so output is staged in a pending block (invisible)
    await setupTauriMock(page, { integration: false });
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
    await emitPtyOutput(page, 'echo classic-mode\r\nclassic-mode-output\r\n');
    await page.waitForTimeout(600);
    // No OSC 133 markers -> no exit-code context and no rendered output
    await expect(page.getByTestId('exit-code')).toHaveCount(0);
    await expect(page.getByText('classic-mode-output')).toHaveCount(0);

    // Set the open mode to classic (zsh) -> a new page renders the classic terminal directly
    await page.addInitScript(() => {
      localStorage.setItem('vrykell-agent-settings', JSON.stringify({
        state: { global: { openModeByShell: { zsh: 'classic', bash: 'classic' } }, overrides: {} },
        version: 8,
      }));
    });
    await page.reload();
    // Classic scene: no bottom command bar and a visible xterm
    await expect(page.locator('.xterm').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByPlaceholder(/输入命令/)).toHaveCount(0);
    await emitPtyOutput(page, 'echo classic-mode\r\nclassic-mode-output\r\n');
    // The WebGL renderer paints terminal output into a canvas rather than the DOM, so assert against the xterm buffer
    await expectAnyTermContains(page, 'classic-mode-output', 5000);
  });

  test('entering and leaving altScreen shows the TUI banner', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    const input = page.getByPlaceholder(/输入命令/);
    await expect(input).toBeVisible({ timeout: 5000 });

    // Wait for the shell startup prompt before injecting a sustained command.
    await page.waitForFunction(async () => {
      const path = '/src/features/terminal/stores/terminal.ts';
      const { useTerminalStore } = await import(path) as typeof import('../src/features/terminal/stores/terminal');
      return Object.values(useTerminalStore.getState().startupStates).includes('ready');
    });
    // Inject the altScreen sequence directly through PTY output
    await emitPtyOutput(
      page,
      '\x1b]133;A\x07' +
        '\x1b]133;E;dm0=\x07' + // base64('vim')
        '\x1b]133;C\x07' +
        '\x1b[?1049h' +
        'VIM BUFFER',
    );

    await expect(page.getByText('TUI')).toBeVisible({ timeout: 5000 });
    const banner = page.getByTestId('tui-banner');
    await expect(banner.locator('[data-tip="终止命令"]')).toBeVisible();
    // Real alt-buffer apps offer no exit full screen action (output only goes to the main xterm and forcing blockList would disconnect the view);
    // only manual full screen from a block card provides one - see running-term.spec.ts
    await expect(banner.locator('[data-tip="退出全屏"]')).toHaveCount(0);

    // Content from a real alt-buffer app must reach the main xterm buffer (rendered on canvas under WebGL, so assert on the buffer).
    // Regression: a manualTui misclassification covered the vim screen, leaving users with frozen block content.
    await expectAnyTermContains(page, 'VIM BUFFER', 5000);

    // Keyboard input must reach the TUI: in the altScreen scene focus routes to the main xterm and onData -> PTY
    // (regression: Esc was captured by a global shortcut and focus landed on an invisible block terminal, so typing failed)
    // Keep this before the button clicks - clicking a banner button steals focus from the xterm
    const writesBefore = (await ptyWrites(page)).length;
    await page.keyboard.press('q');
    await page.keyboard.press('Escape');
    await expect(async () => {
      const writes = await ptyWrites(page);
      expect(writes.length).toBeGreaterThan(writesBefore);
      expect(writes.slice(writesBefore).join('')).toContain('q');
    }).toPass({ timeout: 5000 });

    // Escalating end button: the first click sends SIGTERM and a second click within the window sends SIGKILL.
    // Once armed the data-tip switches to the force-end label, so a combined selector keeps the locator stable.
    const endButton = '[data-tip="结束前台应用"], [data-tip="强制结束前台应用"]';
    const bannerEnd = banner.locator(endButton);
    await expect(bannerEnd).toBeVisible();
    await bannerEnd.click();
    await expect(async () => {
      expect(await ptySignals(page)).toEqual([{ id: 'e2e-session', sig: 15 }]);
    }).toPass({ timeout: 5000 });
    await banner.locator(endButton).click();
    await expect(async () => {
      expect(await ptySignals(page)).toEqual([
        { id: 'e2e-session', sig: 15 },
        { id: 'e2e-session', sig: 9 },
      ]);
    }).toPass({ timeout: 5000 });

    // Leave altScreen
    await emitPtyOutput(page, '\x1b[?1049l\x1b]133;D;0\x07\x1b]133;A\x07');

    await expect(page.getByText('TUI')).not.toBeVisible({ timeout: 5000 });
    // The input bar reappears once the block list is back
    await expect(input).toBeVisible({ timeout: 5000 });
    await page.mouse.move(0, 0);
    // Full-screen TUI frames stay out of block history (alt content only appears live in the main xterm),
    // so history keeps only the shell noise after teardown - full-screen apps must not pollute command history
    await page.locator('[data-testid^="command-block-"]').last().hover();
    await expect(page.getByTestId('exit-code')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('VIM BUFFER')).toHaveCount(0);
  });

  test('an alt sequence combined with other DEC private modes still counts as a full-screen TUI', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    const input = page.getByPlaceholder(/输入命令/);
    await expect(input).toBeVisible({ timeout: 5000 });
    await page.waitForFunction(async () => {
      const path = '/src/features/terminal/stores/terminal.ts';
      const { useTerminalStore } = await import(path) as typeof import('../src/features/terminal/stores/terminal');
      return Object.values(useTerminalStore.getState().startupStates).includes('ready');
    });
    // `\x1b[?1049;2004h` shares one CSI with bracketed paste: it must still count as
    // entering the alt screen instead of leaking into the running block.
    await emitPtyOutput(
      page,
      '\x1b]133;A\x07' +
        '\x1b]133;E;' + btoa('htop') + '\x07' +
        '\x1b]133;C\x07' +
        '\x1b[?1049;2004h' +
        'HTOP FULLSCREEN',
    );
    await expect(page.getByText('TUI')).toBeVisible({ timeout: 5000 });
    await expectAnyTermContains(page, 'HTOP FULLSCREEN', 5000);

    await emitPtyOutput(page, '\x1b[?1049;2004l\x1b]133;D;0\x07\x1b]133;A\x07');
    await expect(page.getByText('TUI')).not.toBeVisible({ timeout: 5000 });
    await page.mouse.move(0, 0);
    await page.locator('[data-testid^="command-block-"]').last().hover();
    await expect(page.getByTestId('exit-code')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('HTOP FULLSCREEN')).toHaveCount(0);
  });

  test('wheel scrolling in altScreen degrades to arrow keys sent to the PTY', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });

    // Enter altScreen (the app has not enabled mouse reporting, so the wheel must degrade to arrow keys)
    await emitPtyOutput(
      page,
      '\x1b]133;A\x07' +
        '\x1b]133;E;dm0=\x07' +
        '\x1b]133;C\x07' +
        '\x1b[?1049h' +
        'TUI APP',
    );
    await expect(page.getByText('TUI')).toBeVisible({ timeout: 5000 });
    await expectAnyTermContains(page, 'TUI APP', 5000);

    // Scroll in the middle of the visible main xterm (hidden block xterms are also in the DOM, so filter with :visible;
    // the top 29px is the TUI banner, where the wheel never reaches the xterm, so avoid it)
    const box = await page.locator('.xterm:visible').boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);

    const before = (await ptyWrites(page)).length;
    await page.mouse.wheel(0, 200);
    await expect(async () => {
      const writes = (await ptyWrites(page)).slice(before).join('');
      expect(writes).toContain('\x1b[B');
    }).toPass({ timeout: 5000 });

    const beforeUp = (await ptyWrites(page)).length;
    await page.mouse.wheel(0, -200);
    await expect(async () => {
      const writes = (await ptyWrites(page)).slice(beforeUp).join('');
      expect(writes).toContain('\x1b[A');
    }).toPass({ timeout: 5000 });
  });

  test('global search opens a centered dialog on Cmd+F and focuses it', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
    // The TopDock search trigger is visible instead of a permanent input
    const trigger = page.getByTestId('global-search-trigger');
    await expect(trigger).toBeVisible({ timeout: 3000 });
    // Cmd+F opens the centered search window and focuses the search field
    await page.keyboard.press('Meta+f');
    const searchInput = page.getByPlaceholder(/搜索文件/);
    await expect(searchInput).toBeVisible({ timeout: 3000 });
    await expect(searchInput).toBeFocused();
    // Escape closes the dialog
    await page.keyboard.press('Escape');
    await expect(searchInput).not.toBeVisible();
  });

  test('clicking the global search filter panel does not crash', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Meta+f');
    const searchInput = page.getByPlaceholder(/搜索文件/);
    await expect(searchInput).toBeVisible({ timeout: 3000 });
    // Click the filter button -> the filter panel opens (a conditional hook here used to crash)
    await page.getByTestId('search-filter-button').click();
    await expect(page.getByText('搜索范围')).toBeVisible({ timeout: 3000 });
    // Toggling a source does not crash and the search field stays interactive
    await page.getByRole('menuitemcheckbox', { name: /历史命令/ }).click();
    await expect(searchInput).toBeVisible();
  });

  test('the bottom command input bar is visible', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    const cmdInput = page.getByPlaceholder(/输入命令/);
    await expect(cmdInput).toBeVisible({ timeout: 5000 });
  });

  test('Cmd+P opens the command palette', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Meta+p');
    await expect(page.getByPlaceholder('搜索命令…')).toBeVisible({ timeout: 3000 });
    await page.keyboard.press('Escape');
    await expect(page.getByPlaceholder('搜索命令…')).not.toBeVisible();
  });

  test('Cmd+W does not clash with the command palette (p and w are distinct)', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
    // Cmd+P opens the palette
    await page.keyboard.press('Meta+p');
    await expect(page.getByPlaceholder('搜索命令…')).toBeVisible({ timeout: 3000 });
    await page.keyboard.press('Escape');
    // Cmd+W must not open the palette
    await page.keyboard.press('Meta+w');
    await expect(page.getByPlaceholder('搜索命令…')).not.toBeVisible();
  });

  // Regression: estimating snapshot row height from font size made it several pixels
  // shorter than the measured canvas cell. Full-row TUI backgrounds then overlapped.
  test('completed block snapshot line height equals the measured canvas cell height', async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    const input = page.getByPlaceholder(/输入命令/);
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill('echo first-line');
    await input.press('Enter');
    await expect(page.getByText('first-line').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('exit-code').first()).toHaveText('0', { timeout: 5000 });

    const metrics = await page.evaluate(async () => {
      const font = await import('/src/features/terminal/model/terminalFont.ts');
      const { termInstances } = await import('/src/features/terminal/stores/terminal.ts');
      const { getCellMetrics } = await import('/src/utils/termMetrics.ts');
      const live = [...termInstances.values()].find((term) => term.element);
      const output = document.querySelector<HTMLElement>('.command-block-output [data-selectable]');
      return {
        measured: font.measureTerminalDomCellHeight(),
        published: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--terminal-row-height')),
        liveCellHeight: live ? getCellMetrics(live).height : null,
        snapshotLineHeight: output ? Number.parseFloat(getComputedStyle(output).lineHeight) : null,
      };
    });

    expect(metrics.measured).toBeGreaterThan(0);
    // Publish the measured row height to CSS instead of estimating it from the font size.
    expect(metrics.published).toBe(metrics.measured);
    // The snapshot container uses the published row height.
    expect(metrics.snapshotLineHeight).toBe(metrics.measured);
    // The snapshot and live canvas share the same cell height.
    if (metrics.liveCellHeight !== null) expect(metrics.measured).toBe(metrics.liveCellHeight);
  });
});
