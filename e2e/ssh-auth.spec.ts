import { test, expect, type Page } from '@playwright/test';
import { setupTauriMock, emitPtyOutput, expectAnyTermContains, ptyWrites } from './tauri-mock';
import { readFileSync } from 'node:fs';

const conptyOutput = JSON.parse(readFileSync(new URL('./fixtures/ssh-conpty-output.json', import.meta.url), 'utf8')) as Array<{ command: string; output: string }>;

for (const sshPreexec of [true, false]) {
  test(`SSH block commands render ls and pwd output with preexec=${sshPreexec}`, async ({ page }) => {
    await setupTauriMock(page, { sshPreexec });
    await page.addInitScript(() => localStorage.setItem('vrykell-agent-settings', JSON.stringify({ version: 8, state: { global: { sshOpenMode: 'block' }, overrides: {} } })));
    await page.goto('/');
    await page.locator('[data-dock-btn="ssh"]').click();
    await page.getByTestId('ssh-row-ssh-1').dblclick();
    await expect(page.getByTestId('ssh-connection-input')).toBeHidden();
    const editor = page.getByPlaceholder(/输入命令/).last();
    for (let index = 0; index < 2; index++) {
      await editor.fill('ls');
      await editor.press('Enter');
      await expect(page.locator('[data-testid^="command-block-"]').filter({ hasText: 'Documents Downloads notes.txt' })).toHaveCount(index + 1);
      const block = page.locator('[data-testid^="command-block-"]').filter({ hasText: 'Documents Downloads notes.txt' }).last();
      await expect(block.locator('[data-selectable]').last()).toBeInViewport();
      await expect.poll(() => block.evaluate(el => el.getBoundingClientRect().height)).toBeLessThan(140);
    }
    await editor.fill('pwd');
    await editor.press('Enter');
    await expect(page.locator('[data-testid^="command-block-"] .command-block-output').filter({ hasText: '/home/e2e/project' })).toHaveCount(1);
    expect((await ptyWrites(page)).filter(data => data === 'ls\n')).toHaveLength(2);
    await expect(page.locator('[data-testid^="running-block-"]')).toHaveCount(0);
  });
}

async function openSsh(page: Page, host: 'known' | 'unknown' | 'changed', confirmed = true) {
  await setupTauriMock(page, { integration: false, sshHost: host, sshTrustConfirmed: confirmed });
  await page.addInitScript(() => localStorage.setItem('vrykell-agent-settings', JSON.stringify({ version: 8, state: { global: { sshOpenMode: 'block' }, overrides: {} } })));
  await page.goto('/');
  await page.locator('[data-dock-btn="ssh"]').click();
  await page.getByTestId('ssh-row-ssh-1').dblclick();
}

async function ipcRecords(page: Page, key: string): Promise<Record<string, unknown>[]> {
  return page.evaluate(name => (window as unknown as Record<string, Record<string, unknown>[]>)[name] ?? [], key);
}

test('the connection screen keeps no scrollbar of its own', async ({ page }) => {
  await openSsh(page, 'known');
  await emitPtyOutput(page, 'ready\r\n');
  const surface = page.getByTestId('ssh-connection-input');
  await expect(surface.locator('.xterm-viewport')).toHaveCSS('scrollbar-width', 'none');
  const mode = page.getByTestId('ssh-input-mode').last();
  const disconnect = page.getByTestId('ssh-session-toolbar').last().getByRole('button', { name: '断开连接', exact: true });
  await expect(mode).toHaveCSS('height', '32px');
  await expect(disconnect).toHaveCSS('height', '32px');
});

test('the connection screen snaps its character cells to whole pixels', async ({ page }) => {
  await openSsh(page, 'known');
  await emitPtyOutput(page, 'ready\r\n');
  // Whole-pixel character cells: otherwise a sub-pixel column remains at the canvas's right edge, looking like a thin line beside a selection
  const cellWidth = await page.evaluate(() => {
    const map = (window as unknown as { __vrykellTerms?: Map<string, unknown> }).__vrykellTerms!;
    const term = [...map.values()][0] as {
      _core?: { _renderService?: { dimensions?: { css?: { cell?: { width?: number } } } } };
    };
    return term?._core?._renderService?.dimensions?.css?.cell?.width ?? 0;
  });
  expect(cellWidth).toBeGreaterThan(0);
  expect(Number.isInteger(cellWidth)).toBe(true);
});

test('SSH authentication snapshots and disconnected output follow the terminal typography', async ({ page }) => {
  await openSsh(page, 'known');
  await emitPtyOutput(page, "user@server's password: ");
  const snapshot = page.locator('pre[data-testid="ssh-terminal-screen"]');
  await expect(snapshot).toBeVisible();
  await expect(snapshot).toHaveCSS('font-size', '14px');
  await page.evaluate(async () => {
    const path = '/src/config/typography.ts';
    const { useTypographyStore } = await import(path) as typeof import('../src/config/typography');
    useTypographyStore.getState().update({ terminalFontPreset: 'Cascadia Code', terminalFontSize: 18, terminalFontWeight: 600, terminalLineHeight: 1.2 });
  });
  await expect(snapshot).toHaveCSS('font-size', '18px');
  await expect(snapshot).toHaveCSS('font-weight', '600');
  await expect.poll(() => snapshot.evaluate(element => getComputedStyle(element).fontFamily)).toContain('Cascadia Code');
  const metrics = await snapshot.evaluate(element => {
    const css = getComputedStyle(element);
    const root = getComputedStyle(document.documentElement);
    return { spacing: css.letterSpacing, expectedSpacing: root.getPropertyValue('--terminal-letter-spacing').trim(), height: css.lineHeight, expectedHeight: root.getPropertyValue('--terminal-row-height').trim() };
  });
  expect(metrics.height).toBe(metrics.expectedHeight);
  expect(metrics.spacing === 'normal' ? '0px' : metrics.spacing).toBe(metrics.expectedSpacing);
  await page.screenshot({ path: 'test-results/ssh-auth-font-wide.png' });
  await page.setViewportSize({ width: 720, height: 800 });
  await expect(snapshot).toHaveCSS('font-size', '18px');
  await page.screenshot({ path: 'test-results/ssh-auth-font-narrow.png' });
  await page.getByTestId('ssh-session-toolbar').last().getByRole('button', { name: '取消认证' }).click();
  const ended = page.getByTestId('ssh-terminal-ended');
  await expect(ended).toHaveCSS('font-size', '18px');
  await expect(ended).toHaveCSS('font-weight', '600');
  await expect.poll(() => ended.evaluate(element => getComputedStyle(element).fontFamily)).toContain('Cascadia Code');
});

test('native SSH recordings distinguish an empty directory from missing command output', async ({ page }) => {
  await openSsh(page, 'known');
  await emitPtyOutput(page, '\x1b]133;A\x07');
  await expect(page.getByTestId('ssh-connection-input')).toBeHidden();

  // Replay sanitized native SSH output, including the full blank-screen repaint.
  for (const recording of conptyOutput) {
    await emitPtyOutput(page, recording.output);
  }
  const blocks = page.locator('[data-testid^="command-block-"]');
  await expect(blocks).toHaveCount(4);
  await expect(blocks.nth(0).getByTestId('exit-code')).toHaveText('0');
  // An empty directory leaves no output region: the block keeps only its info row and command.
  await expect(blocks.nth(0).locator('.command-block-output')).toHaveCount(0);
  await expect(page.getByText('命令未产生输出')).toHaveCount(0);
  await expect(blocks.nth(1).locator('[data-selectable]').last()).toContainText('/home/fixture');
  await expect(blocks.nth(2).locator('[data-selectable]').last()).toContainText('share');
  await expect(blocks.nth(3).locator('[data-selectable]').last()).toContainText('stderr-visible');
  await expect(blocks.nth(0).getByRole('button', { name: /展开|折叠/ })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('ssh-conpty-empty-and-visible-output.png') });
});

test('first SSH connection confirms its fingerprint and accepts authentication input', async ({ page }) => {
  await openSsh(page, 'unknown');
  const surface = page.getByTestId('ssh-connection-input');
  await expect(surface).toBeVisible();
  await expect(page.getByTestId('workspace-area-terminal')).toHaveAttribute('aria-current', 'page');
  const dialogs = await ipcRecords(page, '__SSH_DIALOGS__');
  expect(dialogs).toHaveLength(1);
  expect(dialogs[0]?.message).toContain('SHA256:e2e-verified-key');
  expect(await ipcRecords(page, '__SSH_TRUSTS__')).toMatchObject([{ host: 'prod.example.com', port: 22, expectedFingerprint: 'SHA256:e2e-verified-key', options: { host: 'prod.example.com', port: 22, user: 'root' } }]);
  const sshSpawns = (await ipcRecords(page, '__PTY_SPAWNS__')).filter(s => s.ssh);
  expect(sshSpawns).toHaveLength(1);
  expect(sshSpawns[0]?.ssh).toMatchObject({ hostKeyType: 'ed25519' });
  // Authentication input follows remote output: it appears only when the server actually asks for a password
  await emitPtyOutput(page, '请输入远端密码：');
  await expect(surface.locator('pre')).toContainText('请输入远端密码：');
  const response = surface.getByLabel('SSH 认证响应');
  await expect(response).toBeEnabled();
  await response.fill('test-response');
  await response.press('Enter');
  expect(await ptyWrites(page)).toContain('test-response\r');
  await expect(response).toHaveCount(0);
  // The interactive SSH screen is rendered by xterm so its native cursor follows VT state.
  const xtermHost = surface.getByTestId('ssh-terminal-screen');
  await expect(xtermHost).toBeVisible();
  await expect(xtermHost).toHaveCSS('visibility', 'visible');
  await expect(surface.getByTestId('ssh-screen-cursor')).toHaveCount(0);
  await emitPtyOutput(page, '\r\n\x1b]133;A\x07');
  await expect(surface).toBeHidden();
  await expect(page.getByPlaceholder(/输入命令/).last()).toBeVisible();
});

test('canceling authentication closes the PTY and leaves no editable password field', async ({ page }) => {
  await openSsh(page, 'known');
  const surface = page.getByTestId('ssh-connection-input');
  await expect(surface).toBeVisible();
  await emitPtyOutput(page, "user@server's password: ");
  const response = surface.getByLabel('SSH 认证响应');
  await expect(response).toBeEnabled();
  await expect(response).toHaveCSS('font-size', '13px');
  await expect(response).toHaveCSS('line-height', '32px');
  await expect(response).toHaveCSS('padding', '0px');
  await response.locator('..').screenshot({ path: test.info().outputPath('ssh-auth-empty.png') });
  await response.fill('unsent-secret');
  await expect(response).toHaveCSS('font-size', '20px');
  await expect(response).toHaveCSS('letter-spacing', '2px');
  await page.getByTestId('ssh-session-toolbar').last().getByRole('button', { name: '取消认证' }).click();
  await expect(page.getByTestId('ssh-session-toolbar').last().getByRole('status')).toHaveText('已取消认证，SSH 连接已关闭');
  expect(await ipcRecords(page, '__PTY_CLOSES__')).toContainEqual({ id: 'e2e-session' });
  await expect(response).toHaveCount(0);
  expect(await ptyWrites(page)).not.toContain('unsent-secret\r');
  expect(await ptyWrites(page)).not.toContain('\x03');
  await emitPtyOutput(page, 'late password prompt');
  // After disconnecting the screen freezes at that moment: late output is no longer painted on the page
  await expect(surface.getByTestId('ssh-terminal-ended')).not.toContainText('late password prompt');
});

test('a logged-in SSH command does not retain the previous password prompt', async ({ page }) => {
  await openSsh(page, 'known');
  const surface = page.getByTestId('ssh-connection-input');
  await emitPtyOutput(page, "user@server's password: ");
  await expect(surface.getByLabel('SSH 认证响应')).toBeEnabled();
  await emitPtyOutput(page, "user@server's password: \r\n\x1b]133;A\x07user@server's password: \r\nls\r\n\x1b]133;E;bHM=\x07\x1b]133;C\x07\x1b[H\x1b[2Jfile.txt\r\n\x1b]133;D;0\x07\x1b]133;A\x07");
  await expect(surface).toBeHidden();
  await expect(page.getByLabel('SSH 认证响应')).toHaveCount(0);
  await expect(page.getByText('file.txt', { exact: true })).toBeVisible();
  await expect(page.getByText("user@server's password:", { exact: true })).toBeHidden();
});

test('SSH block mode remains directly interactive when the remote server has no shell integration', async ({ page }) => {
  await openSsh(page, 'known');
  const surface = page.getByTestId('ssh-connection-input');
  await emitPtyOutput(page, "user@server's password: ");
  const response = surface.getByLabel('SSH 认证响应');
  await expect(response).toBeEnabled();
  await response.fill('test-response');
  await response.press('Enter');

  // A forced-command/chat server can redraw its normal screen without emitting OSC 133.
  await emitPtyOutput(page, '\r\n\x1b[2J\x1b[H已登录交互程序\r\n方向键选择，Enter 确认，Esc 退出\r\nuser@server\'s password: ');
  await expect(page.getByTestId('ssh-session-toolbar').last().getByRole('status')).toHaveText('SSH 交互会话');
  await expect(surface.getByLabel('SSH 认证响应')).toHaveCount(0);
  await expect(surface.locator('.xterm-screen')).toBeVisible();

  // The input mode is an explicit single choice (shared Select), no longer a button that flips its label
  await page.getByTestId('ssh-input-mode').last().click();
  await page.getByRole('option', { name: '密码输入' }).click();
  await expect(surface.getByLabel('SSH 认证响应')).toBeVisible();
  // The screen freezes into a snapshot (live rendering stops and no terminal cursor remains)
  await expect(surface.locator('pre[data-testid="ssh-terminal-screen"]')).toBeVisible();
  await expect(surface.locator('.xterm-screen')).toBeHidden();
  await page.getByTestId('ssh-input-mode').last().click();
  await page.getByRole('option', { name: '直接输入' }).click();

  await surface.getByRole('textbox', { name: 'SSH 交互终端' }).click();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  expect(await ptyWrites(page)).toEqual(expect.arrayContaining(['\x1b[B', '\r', '\x1b']));
  await page.getByTestId('ssh-session-toolbar').last().getByRole('button', { name: '断开连接' }).click();
  await expect(page.getByTestId('ssh-session-toolbar').last().getByRole('status')).toHaveText('已断开 SSH 连接');
  // The reason is printed straight on the screen without expanding any collapsed section
  await expect(surface.getByTestId('ssh-terminal-ended')).toContainText('已登录交互程序');
});

test('SSH block mode restores its xterm host when a command opens an alternate-screen app', async ({ page }) => {
  await openSsh(page, 'known');
  const surface = page.getByTestId('ssh-connection-input');

  // The remote shell prompt switches from the authentication xterm to the block list.
  await emitPtyOutput(page, '\x1b]133;A\x07');
  await expect(surface).toBeHidden();
  await expect(page.getByPlaceholder(/输入命令/).last()).toBeVisible();

  // A command starts in a block, then enters a full-screen TUI that must use the same xterm.
  await emitPtyOutput(page, '\x1b]133;E;dmlt\x07\x1b]133;C\x07\x1b[?1049hSSH-BLOCK-TUI');
  await expect(page.getByText('TUI')).toBeVisible();
  await expect(surface).toBeVisible();
  await expect(surface.locator('.xterm-screen')).toBeVisible();
  await expectAnyTermContains(page, 'SSH-BLOCK-TUI');

  await emitPtyOutput(page, '\x1b[?1049l\x1b]133;D;0\x07\x1b]133;A\x07');
  await expect(page.getByText('TUI')).toBeHidden();
  await expect(surface).toBeHidden();
  await expect(page.getByPlaceholder(/输入命令/).last()).toBeVisible();
});

test('canceling host trust does not spawn SSH or record a key', async ({ page }) => {
  await openSsh(page, 'unknown', false);
  await expect(page.getByTestId('ssh-terminal-ended')).toContainText('已取消 SSH 连接');
  expect(await ipcRecords(page, '__SSH_TRUSTS__')).toEqual([]);
  expect((await ipcRecords(page, '__PTY_SPAWNS__')).filter(s => s.ssh)).toEqual([]);
  // Without a password prompt there is no authentication input box
  await expect(page.getByLabel('SSH 认证响应')).toHaveCount(0);
});

test('changed host keys fail without asking to overwrite trust', async ({ page }) => {
  await openSsh(page, 'changed');
  await expect(page.getByTestId('ssh-terminal-ended')).toContainText('主机密钥不匹配');
  expect(await ipcRecords(page, '__SSH_DIALOGS__')).toEqual([]);
  expect(await ipcRecords(page, '__SSH_TRUSTS__')).toEqual([]);
  expect((await ipcRecords(page, '__PTY_SPAWNS__')).filter(s => s.ssh)).toEqual([]);
});

test('the authentication input bar is horizontally symmetric inside the terminal area (no longer pushed right by an 8px left margin)', async ({ page }) => {
  await openSsh(page, 'known');
  const surface = page.getByTestId('ssh-connection-input');
  await emitPtyOutput(page, "user@server's password: ");
  await expect(surface.getByLabel('SSH 认证响应')).toBeEnabled();

  const gaps = await surface.evaluate((host) => {
    const form = host.querySelector('form.terminal-composer');
    if (!form) return null;
    const bar = form.getBoundingClientRect();
    const pane = host.getBoundingClientRect();
    return {
      left: Math.round(bar.left - pane.left),
      right: Math.round(pane.right - bar.right),
    };
  });
  expect(gaps).not.toBeNull();
  // Symmetric with the terminal area's left and right edges: the left gap is no longer 8px wider than the right one
  expect(Math.abs((gaps?.left ?? 0) - (gaps?.right ?? 0))).toBeLessThanOrEqual(1);
});
