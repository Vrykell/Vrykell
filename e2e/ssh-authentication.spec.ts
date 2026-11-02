import { expect, test, type Page } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

async function prepareAuthentication(page: Page, theme: 'dark' | 'light' = 'dark') {
  await setupTauriMock(page, { integration: false });
  await page.addInitScript(theme => localStorage.setItem('vrykell-theme-mode', theme), theme);
  await page.goto('/');
  await page.evaluate(() => {
    const globals = window as unknown as Record<string, unknown>;
    const internals = globals.__TAURI_INTERNALS__ as { invoke: (command: string, args: Record<string, unknown>) => Promise<unknown> };
    const original = internals.invoke;
    let authenticated = false;
    let cancelled = 0;
    let attempts = 0;
    let round = 0;
    let send: ((value: unknown) => void) | undefined;
    let finish: (() => void) | undefined;
    let fail: ((reason: Error) => void) | undefined;
    const target = { connectionId: 'ssh-1', host: 'gateway.test', port: 2222, user: 'jump-user' };
    const challenge = () => send?.(round === 1
      ? { kind: 'hostKey', round, target, fingerprint: 'SHA256:fixture-gateway', keyType: 'ed25519' }
      : { kind: 'prompts', round, target: round === 2 ? target : { ...target, host: '10.0.0.1', user: 'root', port: 22 },
        instructions: round === 2 ? 'Enter both account fields' : 'Enter the current verification code',
        prompts: round === 2 ? [{ text: 'Account:', echo: true }, { text: 'Password:', echo: false }] : [{ text: 'One-time code:', echo: false }] });
    globals.__AUTH_STATE__ = () => ({ authenticated, cancelled, attempts });
    internals.invoke = async (command, args) => {
      if (command === 'ssh_system_status' && !authenticated) throw new Error(`SSH_CONNECTION_FAILED:${JSON.stringify({
        connectionId: 'gateway', host: 'gateway.test', port: 2222, stage: 'authentication', cause: 'SSH_AUTH_FAILED: Interactive authentication required',
      })}`);
      if (command === 'ssh_authenticate_session') {
        attempts += 1; round = 1;
        send = (args.onChallenge as { onmessage: (value: unknown) => void }).onmessage;
        return new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; queueMicrotask(challenge); });
      }
      if (command === 'ssh_authentication_respond') {
        if (args.round !== round) throw new Error('Stale challenge');
        const responses = args.responses as string[];
        const expected = round === 1 ? ['SHA256:fixture-gateway'] : round === 2 ? ['operator', 'fixture-password'] : ['123456'];
        if (JSON.stringify(responses) !== JSON.stringify(expected)) throw new Error('Rejected answer');
        if (round < 3) { round += 1; queueMicrotask(challenge); }
        else { authenticated = true; finish?.(); }
        return;
      }
      if (command === 'ssh_authentication_cancel') { cancelled += 1; fail?.(new Error('SSH_AUTH_CANCELLED: Authentication cancelled')); return; }
      return original(command, args);
    };
  });
  await page.getByTestId('workspace-area-ssh').click();
  await page.getByTestId('ssh-row-ssh-1').dblclick();
  await page.getByTestId('ssh-status-toggle').last().click();
  await expect(page.getByText('连接 gateway.test:2222 时，认证阶段失败。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '认证服务', exact: true }).click();
  const dialog = page.getByTestId('ssh-auth-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: '认证方式' }).click();
  await page.getByRole('option', { name: '服务器交互验证（MFA）' }).click();
  await dialog.getByRole('button', { name: '认证', exact: true }).click();
  return dialog;
}

for (const [theme, width] of [['dark', 1240], ['light', 520]] as const) {
  test(`interactive authentication shares service success in ${theme} at ${width}px`, async ({ page }, info) => {
    const dialog = await prepareAuthentication(page, theme);
    await page.setViewportSize({ width, height: 800 });
    await expect(dialog.getByLabel('主机指纹')).toHaveValue('ed25519 SHA256:fixture-gateway');
    await dialog.getByRole('button', { name: '信任并连接' }).click();
    await expect(dialog.getByLabel('Account:')).toBeFocused();
    await expect(dialog.getByLabel('Account:')).toHaveAttribute('type', 'text');
    await expect(dialog.getByLabel('Password:')).toHaveAttribute('type', 'password');
    await dialog.getByLabel('Account:').fill('operator');
    await dialog.getByLabel('Password:').fill('fixture-password');
    await dialog.getByLabel('Password:').press('Enter');
    await expect(dialog.getByLabel('One-time code:')).toHaveValue('');
    await expect(dialog.getByText('root@10.0.0.1:22', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`authentication-${theme}-${width}.png`), animations: 'disabled' });
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await dialog.getByLabel('One-time code:').fill('123456');
    await dialog.getByLabel('One-time code:').press('Enter');
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Linux 6.8', { exact: true })).toBeVisible();
    await page.locator('[data-dock-btn="files"]').click();
    await expect(page.getByText('app.log', { exact: true }).first()).toBeVisible();
    const state = await page.evaluate(() => ((window as unknown as Record<string, () => unknown>).__AUTH_STATE__)());
    expect(state).toEqual({ authenticated: true, cancelled: 0, attempts: 1 });
    const diagnostics = await page.evaluate(async () => {
      const path = '/src/platform/diagnostics.ts';
      return (await import(path) as typeof import('../src/platform/diagnostics')).diagnosticSnapshot();
    });
    expect(JSON.stringify(diagnostics)).not.toMatch(/fixture-password|123456/);
  });
}

test('Escape cancels an interactive challenge without completing service authentication', async ({ page }) => {
  const dialog = await prepareAuthentication(page);
  await dialog.getByRole('button', { name: '信任并连接' }).click();
  await dialog.getByLabel('Password:').fill('unused-password');
  await dialog.getByLabel('Password:').press('Escape');
  await expect(dialog).toBeHidden();
  await expect.poll(() => page.evaluate(() => ((window as unknown as Record<string, () => unknown>).__AUTH_STATE__)())).toEqual({ authenticated: false, cancelled: 1, attempts: 1 });
});
