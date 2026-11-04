import { test, expect } from '@playwright/test';
import { setupTauriMock, waitForWorkbench } from './tauri-mock';

test('terminal connection does not force the file panel open; unavailable files have a recovery path', async ({ page }) => {
  await setupTauriMock(page, { integration: false });
  await page.addInitScript(() => {
    const ipc = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const invoke = ipc.invoke;
    const fixture = window as unknown as { __FILE_SERVICE_AVAILABLE__?: boolean };
    ipc.invoke = async (command, args) => {
      if (command === 'ssh_list') {
        if (!fixture.__FILE_SERVICE_AVAILABLE__) throw new Error('SFTP_UNAVAILABLE:subsystem request failed');
        return { base: '/home/tester', entries: [{ name: '恢复后的文件.txt', path: '/home/tester/恢复后的文件.txt', is_dir: false }] };
      }
      return invoke(command, args);
    };
  });
  await page.goto('/');
  await page.locator('[data-dock-btn="ssh"]').click();
  await page.getByTestId('ssh-row-ssh-1').dblclick();
  await expect(page.getByTestId('workspace-area-terminal')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('[data-dock-btn="files"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: '断开连接', exact: true })).toBeEnabled();
  await page.locator('[data-dock-btn="files"]').click();
  await expect(page.getByText('此连接暂不能浏览文件', { exact: true })).toBeVisible();
  await expect(page.locator('#app-notifications').getByRole('alert')).toContainText('此连接暂不能浏览文件');
  await expect(page.getByTestId('ssh-file-search-btn')).toBeDisabled();
  await expect(page.getByText('空目录', { exact: true })).toHaveCount(0);
  await page.evaluate(() => { (window as unknown as { __FILE_SERVICE_AVAILABLE__: boolean }).__FILE_SERVICE_AVAILABLE__ = true; });
  await page.getByRole('button', { name: '重试文件服务' }).click();
  await expect(page.getByText('恢复后的文件.txt')).toBeVisible();
  await page.getByRole('button', { name: '关闭资源面板' }).click();
  await expect(page.getByTestId('ssh-terminal-screen')).toBeVisible();
});

for (const failure of [
  { label: 'handshake', error: 'SSH 握手失败：[Session(-5)] Unable to exchange encryption keys', title: '此连接暂不能浏览文件' },
  { label: 'saved authentication', error: '[Session(-18)] Authentication failed (username/password)', title: '已保存的 SSH 认证信息被拒绝' },
]) test(`file ${failure.label} failure is described independently of the terminal connection`, async ({ page }) => {
  await setupTauriMock(page, { integration: false });
  await page.addInitScript(error => {
    const ipc = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const invoke = ipc.invoke;
    ipc.invoke = (command, args) => command === 'ssh_list' ? Promise.reject(new Error(error)) : invoke(command, args);
  }, failure.error);
  await page.goto('/');
  await page.locator('[data-dock-btn="ssh"]').click();
  await page.getByTestId('ssh-row-ssh-1').dblclick();
  await page.locator('[data-dock-btn="files"]').click();
  await expect(page.getByText(failure.title, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '继续使用终端' }).click();
  await expect(page.getByTestId('ssh-terminal-screen')).toBeVisible();
  await expect(page.getByText(failure.title, { exact: true })).toBeHidden();
});

for (const [theme, width] of [['dark', 1240], ['light', 720]] as const) {
  test(`service recovery uses compact notifications and shared authentication fields in ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 640 });
    await setupTauriMock(page, { integration: false });
    await page.addInitScript(theme => {
      localStorage.setItem('vrykell-theme-mode', theme);
      const fixture = window as unknown as { __FILE_SERVICE_AVAILABLE__?: boolean; __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } };
      const original = fixture.__TAURI_INTERNALS__.invoke;
      fixture.__TAURI_INTERNALS__.invoke = (command, args) => command === 'ssh_list' && !fixture.__FILE_SERVICE_AVAILABLE__
        ? Promise.reject(new Error('SSH_AUTH_FAILED: Saved password was rejected')) : original(command, args);
    }, theme);
    await page.goto('/');
    await waitForWorkbench(page);
    const expand = page.getByRole('button', { name: '展开侧栏', exact: true });
    if (await expand.isVisible()) await expand.click();
    await page.getByTestId('workspace-area-ssh').click();
    await page.getByTestId('ssh-row-ssh-1').dblclick();
    if (width < 900) await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
    await page.locator('[data-dock-btn="files"]').click();
    const notification = page.locator('#app-notifications').getByRole('alert');
    await expect(notification).toContainText('已保存的 SSH 认证信息被拒绝');
    await expect(page.getByTestId('ssh-file-tree').getByRole('alert')).toHaveCount(0);
    const authenticate = notification.getByRole('button', { name: '认证服务', exact: true });
    for (const name of ['认证服务', '继续使用终端', '重试文件服务']) {
      expect((await notification.getByRole('button', { name, exact: true }).boundingBox())!.height).toBeLessThanOrEqual(32);
    }
    await notification.getByRole('button', { name: '技术详情', exact: true }).click();
    await expect(notification.getByText('SSH_AUTH_FAILED: Saved password was rejected', { exact: true })).toBeVisible();
    await notification.screenshot({ path: info.outputPath(`service-error-${theme}.png`), animations: 'disabled' });
    await authenticate.click();
    const dialog = page.getByTestId('ssh-auth-dialog');
    await expect(notification).toBeHidden();
    const secret = dialog.getByLabel('服务器密码', { exact: true });
    await expect(secret).toBeFocused();
    await expect(secret).toHaveAttribute('type', 'password');
    await expect(secret).toHaveCSS('min-height', '32px');
    await expect(secret).toHaveCSS('padding-top', '6px');
    await expect(secret).toHaveCSS('border-radius', '10px');
    expect(await secret.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(await dialog.getByRole('combobox', { name: '认证方式' }).evaluate(element => getComputedStyle(element).backgroundColor));
    await secret.fill('masked-layout-fixture');
    await dialog.screenshot({ path: info.outputPath(`service-authentication-${theme}.png`), animations: 'disabled' });
    await page.evaluate(() => document.documentElement.style.setProperty('--ui-font-scale', '1.25'));
    await expect(secret).toHaveCSS('font-size', '15px');
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(640);
    await dialog.screenshot({ path: info.outputPath(`service-authentication-${theme}-125.png`), animations: 'disabled' });
    await secret.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(notification).toBeVisible();
    expect(await notification.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await notification.screenshot({ path: info.outputPath(`service-error-${theme}-125.png`), animations: 'disabled' });
    await expect(authenticate).toBeFocused();
    await page.evaluate(() => { (window as unknown as { __FILE_SERVICE_AVAILABLE__: boolean }).__FILE_SERVICE_AVAILABLE__ = true; });
    await notification.getByRole('button', { name: '重试文件服务', exact: true }).click();
    await expect(page.getByText('app.log', { exact: true }).first()).toBeVisible();
    await expect(notification).toBeHidden();
  });
}
