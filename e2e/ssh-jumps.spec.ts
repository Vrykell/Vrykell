import { expect, test } from '@playwright/test';
import { emitPtyOutput, ptyWrites, setupTauriMock } from './tauri-mock';

for (const theme of ['dark', 'light']) test(`saved jump connection persists and reaches terminal and services in ${theme}`, async ({ page }, info) => {
  await setupTauriMock(page, { integration: false });
  await page.addInitScript(theme => localStorage.setItem('vrykell-theme-mode', theme), theme);
  await page.goto('/');
  await page.getByTestId('workspace-area-ssh').click();
  await page.getByTestId('ssh-new-btn').click();
  await page.setViewportSize({ width: theme === 'light' ? 720 : 1240, height: 800 });
  const header = page.getByTestId('ssh-host-editor').locator(':scope > header');
  const save = header.getByTestId('ssh-save-btn');
  const cancel = header.getByRole('button', { name: '取消', exact: true });
  for (const zoom of [1, 1.25]) {
    await header.evaluate((element, zoom) => { element.style.zoom = String(zoom); }, zoom);
    const saved = (await save.boundingBox())!;
    const cancelled = (await cancel.boundingBox())!;
    expect(Math.abs(saved.width - cancelled.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(saved.height - cancelled.height)).toBeLessThanOrEqual(1);
  }
  await header.screenshot({ path: info.outputPath(`host-actions-${theme}.png`), animations: 'disabled' });
  await header.evaluate(element => { element.style.zoom = ''; });
  await page.getByTestId('ssh-form-name').fill('Internal via gateway');
  await page.getByTestId('ssh-form-host').fill('internal.test');
  await page.getByTestId('ssh-form-user').fill('destination-user');
  const jump = page.getByTestId('ssh-form-jump-connection');
  await jump.scrollIntoViewIfNeeded();
  await jump.press('Enter');
  const option = page.getByRole('option', { name: '生产服务器', exact: true });
  await expect(option).toBeVisible();
  const triggerBounds = (await jump.boundingBox())!;
  const popupBounds = (await page.getByRole('listbox', { name: '已保存的跳板连接' }).locator('..').boundingBox())!;
  expect(Math.abs(triggerBounds.width - popupBounds.width)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath(`jump-picker-${theme}.png`), animations: 'disabled' });
  await option.click();
  await page.setViewportSize({ width: 1240, height: 800 });
  await expect(page.getByTestId('ssh-form-jump')).toHaveCount(0);
  await page.getByTestId('ssh-test-btn').click();
  await expect(page.getByTestId('ssh-test-result')).toContainText('认证成功');
  await page.getByTestId('ssh-save-btn').click();
  const row = page.locator('[data-testid^="ssh-row-"]', { hasText: 'Internal via gateway' });
  await row.click({ button: 'right' });
  await page.getByRole('button', { name: '编辑连接', exact: true }).click();
  await expect(jump).toHaveText(/生产服务器/);
  await expect(page.getByTestId('ssh-form-user')).toHaveValue('destination-user');
  await page.getByTestId('ssh-save-connect-btn').click();
  await expect(page.getByTestId('ssh-terminal-screen')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __PTY_SPAWNS__: { ssh?: unknown }[] }).__PTY_SPAWNS__.filter(spawn => spawn.ssh)))
    .toContainEqual(expect.objectContaining({ ssh: expect.objectContaining({ host: 'internal.test', user: 'destination-user', jumpConnectionId: 'ssh-1' }) }));
  await page.getByTestId('ssh-status-toggle').last().click();
  await expect(page.getByText('Linux 6.8', { exact: true })).toBeVisible();
  await page.locator('[data-dock-btn="files"]').click();
  await expect(page.getByText('app.log', { exact: true }).first()).toBeVisible();
});

test('interactive SSH can recover stale mouse and focus modes without writing a remote command', async ({ page }) => {
  await setupTauriMock(page, { integration: false });
  await page.goto('/');
  await page.getByTestId('workspace-area-ssh').click();
  await page.getByTestId('ssh-row-ssh-1').dblclick();
  const screen = page.getByTestId('ssh-terminal-screen');
  await expect(screen).toBeVisible();
  await emitPtyOutput(page, '\r\nretained fixture output\r\n\x1b[?1;1003;1004;1006h');
  const readModes = () => page.evaluate(async () => {
    const path = '/src/features/terminal/stores/terminal.ts';
    const { termInstances } = await import(path) as typeof import('../src/features/terminal/stores/terminal');
    const term = [...termInstances.values()].find(term => term.element?.closest('[data-testid="ssh-terminal-screen"]'))!;
    return { mouse: term.modes.mouseTrackingMode, focus: term.modes.sendFocusMode, cursor: term.modes.applicationCursorKeysMode,
      text: Array.from({ length: term.buffer.active.length }, (_, index) => term.buffer.active.getLine(index)?.translateToString(true)).join('\n') };
  });
  await expect.poll(readModes).toMatchObject({ mouse: 'any', focus: true, cursor: true });
  await screen.click({ button: 'right' });
  const writesBeforeReset = await ptyWrites(page);
  await page.getByRole('button', { name: '重置终端输入模式', exact: true }).click();
  await expect.poll(readModes).toMatchObject({ mouse: 'none', focus: false, cursor: false });
  expect((await readModes()).text).toContain('retained fixture output');
  const writes = (await ptyWrites(page)).slice(writesBeforeReset.length);
  expect(writes.every(data => data === '\x1b[O')).toBe(true);
  const count = (await ptyWrites(page)).length;
  const bounds = (await screen.boundingBox())!;
  await page.mouse.move(bounds.x + 90, bounds.y + 70);
  await page.mouse.move(bounds.x + 120, bounds.y + 100);
  await page.mouse.wheel(0, 80);
  await expect.poll(async () => (await ptyWrites(page)).length).toBe(count);
});
