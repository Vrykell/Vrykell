import { test, expect } from '@playwright/test';
import { setupTauriMock, emitPtyOutput } from './tauri-mock';

test('quick connection completes interactive authentication, navigation and reconnect', async ({ page }) => {
  await setupTauriMock(page, { integration: false });
  await page.goto('/');
  await page.locator('[data-dock-btn="ssh"]').click();
  await page.getByTestId('ssh-quick-btn').click();
  await page.getByTestId('ssh-form-host').fill('chat.example.com');
  await page.getByTestId('ssh-form-port').fill('2222');
  await page.getByTestId('ssh-form-user').fill('tester');
  await page.getByTestId('ssh-connect-btn').click();
  const screen = page.getByTestId('ssh-terminal-screen');
  await expect(screen).toBeVisible();
  await emitPtyOutput(page, '\x1b[2J\x1b[Htester@chat.example.com\'s password:');
  await page.getByRole('textbox', { name: 'SSH 认证响应' }).fill('disposable-test-password');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await emitPtyOutput(page, '\x1b[2J\x1b[H测试验证响应：12345678\r\nEnter:ok Esc:quit');
  await expect(page.getByRole('textbox', { name: 'SSH 认证响应' })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'SSH 交互终端' }).press('ArrowDown');
  await page.getByRole('textbox', { name: 'SSH 交互终端' }).press('Enter');
  await emitPtyOutput(page, '\x1b[2J\x1b[Hsshfm\r\nPath: /Test\r\n\x1b[7mSelected item\x1b[0m');
  // Text and ANSI rendition are drawn by xterm's live renderer rather than snapshot HTML.
  await expect(screen.locator('.xterm-screen')).toBeVisible();
  await expect(screen).toHaveCSS('visibility', 'visible');
  await expect(page.getByTestId('ssh-screen-cursor')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'SSH 交互终端' }).press('Escape');
  await emitPtyOutput(page, '\x1b[2J\x1b[Hsshfm\r\nPath: /');
  await expect(screen.locator('.xterm-screen')).toBeVisible();
  await page.getByRole('textbox', { name: 'SSH 交互终端' }).press('q');
  await page.getByRole('button', { name: '断开连接', exact: true }).click();
  await expect(page.getByRole('button', { name: '重新连接' })).toBeVisible();
  await page.getByRole('button', { name: '重新连接' }).click();
  // 重连后先是「取消连接」（还在建立），连上后才变回「断开连接」
  await expect(page.getByRole('button', { name: /^(取消连接|断开连接)$/ })).toBeEnabled();
  const state = await page.evaluate(() => {
    const w = window as unknown as { __PTY_WRITES__: string[]; __PTY_SPAWNS__: { ssh?: { host: string; shellIntegration: boolean } }[] };
    return { writes: w.__PTY_WRITES__, spawns: w.__PTY_SPAWNS__.filter(item => item.ssh) };
  });
  expect(state.writes).toContain('disposable-test-password\r');
  expect(state.writes).toContain('\x1b[B');
  expect(state.writes).toContain('\r');
  expect(state.writes).toContain('\x1b');
  expect(state.writes).toContain('q');
  expect(state.spawns).toHaveLength(2);
  expect(state.spawns[0].ssh).toMatchObject({ host: 'chat.example.com', shellIntegration: false });
  // The SSH panel stays open after a quick connection: the saved list keeps its seeded row and
  // never gains the ad-hoc connection.
  await expect(page.locator('[data-testid^="ssh-row-"]', { hasText: '生产服务器' })).toBeVisible();
  await expect(page.locator('[data-testid^="ssh-row-"]', { hasText: 'chat.example.com' })).toHaveCount(0);
});

test('advanced saved options are retained when editing and passed to the terminal', async ({ page }) => {
  await setupTauriMock(page, { integration: false });
  await page.goto('/');
  await page.locator('[data-dock-btn="ssh"]').click();
  await page.getByTestId('ssh-new-btn').click();
  await page.getByTestId('ssh-form-name').fill('跳板连接');
  await page.getByTestId('ssh-form-host').fill('target.example.com');
  await page.getByTestId('ssh-form-user').fill('tester');
  await page.getByRole('button', { name: '密钥', exact: true }).click();
  await page.getByTestId('ssh-form-identity').fill('C:/Keys/private key');
  await page.getByTestId('ssh-form-jump').fill('user@jump.example.com:2222');
  await page.getByTestId('ssh-form-keepalive').fill('45');
  await page.getByTestId('ssh-save-btn').click();
  const row = page.locator('[data-testid^="ssh-row-"]', { hasText: '跳板连接' });
  await row.getByRole('button', { name: '编辑「跳板连接」' }).click();
  await expect(page.getByTestId('ssh-form-identity')).toHaveValue('C:/Keys/private key');
  await expect(page.getByTestId('ssh-form-jump')).toHaveValue('user@jump.example.com:2222');
  await expect(page.getByTestId('ssh-form-keepalive')).toHaveValue('45');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await row.dblclick();
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __PTY_SPAWNS__: { ssh?: unknown }[] }).__PTY_SPAWNS__.filter(item => item.ssh))).toContainEqual(expect.objectContaining({ ssh: expect.objectContaining({ identityFile: 'C:/Keys/private key', jumpHost: 'user@jump.example.com:2222', serverAliveInterval: 45, shellIntegration: false }) }));
});
