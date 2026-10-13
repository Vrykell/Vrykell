import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test('GUI forwarding and text mode preserve rules, copy text, and save and connect', async ({ page }) => {
  await setupTauriMock(page, { sshHost: 'known' });
  await page.goto('/');
  await page.locator('[data-dock-btn="ssh"]').click();
  await page.getByTestId('ssh-new-btn').click();
  await expect(page.getByTestId('ssh-form-name')).toBeFocused();
  await page.getByTestId('ssh-form-name').fill('Mapped server');
  await page.getByTestId('ssh-form-host').fill('server.example.com');
  await page.getByTestId('ssh-form-user').fill('tester');
  await page.getByTestId('ssh-section-tab-forwarding').click();
  await page.getByTestId('ssh-forward-add').click();
  await page.getByTestId('ssh-forward-port-0').fill('8080');
  await page.getByTestId('ssh-forward-target-port-0').fill('80');
  await page.getByRole('combobox', { name: '转发编辑模式' }).click();
  await page.getByRole('option', { name: '文本模式' }).click();
  await expect(page.getByTestId('ssh-form-local-forward')).toHaveValue('8080:localhost:80');
  await page.getByRole('button', { name: '复制本地转发' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __CLIPBOARD_TEXT__: string }).__CLIPBOARD_TEXT__)).toBe('8080:localhost:80');
  await page.getByTestId('ssh-form-local-forward').fill('9090:db:5432');
  await page.getByRole('combobox', { name: '转发编辑模式' }).click();
  await page.getByRole('option', { name: '图形模式' }).click();
  await expect(page.getByTestId('ssh-forward-port-0')).toHaveValue('9090');
  await expect(page.getByTestId('ssh-forward-target-port-0')).toHaveValue('5432');
  await page.getByTestId('ssh-section-tab-advanced').click();
  await page.getByTestId('ssh-form-auto-reconnect').check();
  await expect(page.getByTestId('ssh-form-auto-reconnect')).toHaveCSS('appearance', 'auto');
  await page.getByTestId('ssh-save-connect-btn').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __PTY_SPAWNS__: { ssh?: { localForwards?: string[] } }[] }).__PTY_SPAWNS__.filter(item => item.ssh).map(item => item.ssh?.localForwards))).toEqual([['9090:db:5432']]);
});

test('partial import failures stay in place and retry only failed hosts', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await page.locator('[data-dock-btn="ssh"]').click();
  await page.evaluate(() => {
    const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args: { conn?: { name: string } }) => Promise<unknown> }; __IMPORT_SAVES__: string[] };
    w.__IMPORT_SAVES__ = [];
    const invoke = w.__TAURI_INTERNALS__.invoke;
    let fail = true;
    w.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      if (cmd === 'ssh_connection_save') {
        w.__IMPORT_SAVES__.push(args.conn!.name);
        if (args.conn!.name === 'db' && fail) { fail = false; return Promise.reject(new Error('Permission denied')); }
      }
      return invoke(cmd, args);
    };
  });
  await page.getByTestId('ssh-import-btn').click();
  await page.getByTestId('ssh-import-db').waitFor();
  await page.getByTestId('ssh-import-confirm').click();
  const dialog = page.getByRole('dialog', { name: '导入 SSH 连接' });
  await expect(dialog.getByText('Permission denied')).toBeVisible();
  await expect(dialog.getByTestId('ssh-import-web')).toBeDisabled();
  await expect(dialog.getByTestId('ssh-import-db')).toBeChecked();
  await dialog.getByRole('button', { name: '重试失败项' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __IMPORT_SAVES__: string[] }).__IMPORT_SAVES__)).toEqual(['web', 'db', 'db']);
});

test('pending automatic reconnect has a visible countdown and can be stopped', async ({ page }) => {
  await setupTauriMock(page, { sshHost: 'known', integration: false });
  await page.goto('/');
  await page.locator('[data-dock-btn="ssh"]').click();
  await page.getByTestId('ssh-quick-btn').click();
  await expect(page.getByTestId('ssh-form-host')).toBeFocused();
  await page.getByTestId('ssh-form-host').fill('server.example.com');
  await page.getByTestId('ssh-section-tab-advanced').click();
  await page.getByTestId('ssh-form-auto-reconnect').check();
  await page.getByTestId('ssh-connect-btn').click();
  await page.getByRole('button', { name: '断开连接', exact: true }).waitFor();
  await page.evaluate(() => (window as unknown as { __TAURI_INTERNALS__: { emitPtyExit: (code: number) => void } }).__TAURI_INTERNALS__.emitPtyExit(255));
  await expect(page.getByText(/第 1\/5 次/)).toBeVisible();
  await page.getByRole('button', { name: '停止重试' }).click();
  await expect(page.getByText('已停止自动重连', { exact: true })).toBeVisible();
  await page.waitForTimeout(1300);
  expect(await page.evaluate(() => (window as unknown as { __PTY_SPAWNS__: { ssh?: unknown }[] }).__PTY_SPAWNS__.filter(item => item.ssh).length)).toBe(1);
});
