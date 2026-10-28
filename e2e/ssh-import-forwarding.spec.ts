import { test, expect, type Page, type Locator } from '@playwright/test';
import { setupTauriMock, emitPtyOutput } from './tauri-mock';

async function textForwarding(page: Page, panel: Page | Locator = page) {
  if (await panel.getByTestId('ssh-section-tab-forwarding').count()) await panel.getByTestId('ssh-section-tab-forwarding').click();
  else if (await panel.locator('.ssh-editor-advanced:not([open]) > summary').count()) await panel.locator('.ssh-editor-advanced > summary').click();
  await panel.getByRole('combobox', { name: '转发编辑模式' }).click();
  await page.getByRole('option', { name: '文本模式' }).click();
}

test('imports host aliases from the SSH config and saves forwarding and auto-reconnect with the connection', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await page.locator('[data-dock-btn="ssh"]').click();

  // New aliases are preselected and saved to the connection list.
  await page.getByTestId('ssh-import-btn').click();
  const importDialog = page.getByRole('dialog', { name: '导入 SSH 连接' });
  await expect(importDialog.getByTestId('ssh-import-web')).toBeChecked();
  await expect(importDialog.getByTestId('ssh-import-db')).toBeChecked();
  await importDialog.getByTestId('ssh-import-confirm').click();
  await expect(importDialog).toHaveCount(0);

  await page.getByTestId('ssh-search').fill('web');
  await expect(page.locator('[data-testid^="ssh-row-"]')).toHaveCount(1);
  await expect(page.locator('[data-testid^="ssh-row-"]').filter({ hasText: 'web' })).toBeVisible();
  await page.getByTestId('ssh-search').fill('');

  // Forwarding and reconnect options survive reopening the saved profile.
  await page.getByTestId('ssh-new-btn').click();
  const form = page.getByTestId('ssh-host-editor');
  await form.getByTestId('ssh-form-name').fill('带转发的机器');
  await form.getByTestId('ssh-form-host').fill('tunnel.example.com');
  await textForwarding(page, form);
  await form.getByTestId('ssh-form-local-forward').fill('8080:localhost:80');
  await form.getByTestId('ssh-form-dynamic-forward').fill('1080');
  await form.getByTestId('ssh-form-auto-reconnect').check();
  await form.getByTestId('ssh-save-btn').click();
  await expect(form).toHaveCount(0);

  await page.locator('[data-testid^="ssh-row-"]').filter({ hasText: '带转发的机器' }).click({ button: 'right' });
  await page.getByRole('button', { name: '编辑连接', exact: true }).click();
  const reopened = page.getByTestId('ssh-host-editor');
  await textForwarding(page, reopened);
  await expect(reopened.getByTestId('ssh-form-local-forward')).toHaveValue('8080:localhost:80');
  await expect(reopened.getByTestId('ssh-form-dynamic-forward')).toHaveValue('1080');
  await expect(reopened.getByTestId('ssh-form-auto-reconnect')).toBeChecked();
  await reopened.getByRole('button', { name: '取消', exact: true }).click();
  await expect(reopened).toHaveCount(0);
});

test('an invalid port forward is rejected on save', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await page.locator('[data-dock-btn="ssh"]').click();
  await page.getByTestId('ssh-new-btn').click();

  const form = page.getByTestId('ssh-host-editor');
  await form.getByTestId('ssh-form-name').fill('坏转发');
  await form.getByTestId('ssh-form-host').fill('tunnel.example.com');
  await textForwarding(page, form);
  await form.getByTestId('ssh-form-local-forward').fill('-oProxyCommand=x');
  await form.getByTestId('ssh-save-btn').click();

  // Invalid profiles stay open and are not added to the list.
  await expect(form).toBeVisible();
  await expect(page.getByRole('button', { name: '编辑「坏转发」', exact: true })).toHaveCount(0);
});


test('SSH forwards reach the terminal, drops retry and remote exits stay closed', async ({ page }) => {
  await setupTauriMock(page, { sshHost: 'known', integration: false });
  await page.goto('/');
  await page.locator('[data-dock-btn="ssh"]').click();
  await page.getByTestId('ssh-host-actions').click(); await page.getByRole('button', { name: '快速连接', exact: true }).click();
  await page.getByTestId('ssh-form-host').fill('tunnel.example.com');
  await textForwarding(page);
  await page.getByTestId('ssh-form-local-forward').fill('8080:localhost:80');
  await page.getByTestId('ssh-form-remote-forward').fill('9000:localhost:9000');
  await page.getByTestId('ssh-form-dynamic-forward').fill('1080');
  if (await page.getByTestId('ssh-section-tab-advanced').count()) await page.getByTestId('ssh-section-tab-advanced').click();
  await page.getByTestId('ssh-form-auto-reconnect').check();
  await page.getByTestId('ssh-connect-btn').click();
  const spawns = () => page.evaluate(() =>
    (window as unknown as { __PTY_SPAWNS__: { ssh?: Record<string, unknown> }[] }).__PTY_SPAWNS__.filter(spawn => spawn.ssh));
  await expect.poll(async () => (await spawns()).length).toBe(1);
  expect((await spawns())[0].ssh).toMatchObject({
    localForwards: ['8080:localhost:80'], remoteForwards: ['9000:localhost:9000'], dynamicForwards: ['1080'],
  });
  await page.evaluate(() => {
    (window as unknown as { __TAURI_INTERNALS__: { emitPtyExit: (code: number) => void } }).__TAURI_INTERNALS__.emitPtyExit(255);
  });
  await expect.poll(async () => (await spawns()).length).toBe(2);
  await page.evaluate(() => {
    (window as unknown as { __TAURI_INTERNALS__: { emitPtyExit: (code: number) => void } }).__TAURI_INTERNALS__.emitPtyExit(0);
  });
  await expect(page.getByRole('button', { name: '重新连接' })).toBeVisible();
  // Wait past the initial retry delay and verify the remote exit remains closed.
  await page.waitForTimeout(1300);
  expect(await spawns()).toHaveLength(2);
});

test('SSH multiline paste honours the active bracketed paste mode', async ({ page }) => {
  await setupTauriMock(page, { sshHost: 'known', integration: false });
  await page.goto('/');
  await page.locator('[data-dock-btn="ssh"]').click();
  await page.getByTestId('ssh-host-actions').click(); await page.getByRole('button', { name: '快速连接', exact: true }).click();
  await page.getByTestId('ssh-form-host').fill('tunnel.example.com');
  await page.getByTestId('ssh-connect-btn').click();
  const input = page.getByRole('textbox', { name: 'SSH 交互终端' });
  await expect(input).toBeVisible();
  await emitPtyOutput(page, '\x1b[?2004h');
  // xterm parses writes asynchronously; wait until the bracketed-paste mode is
  // actually applied, or the paste is sent as plain text without the wrapper.
  await expect.poll(() => page.evaluate(() => {
    const terms = (window as unknown as { __vrykellTerms: Map<string, { modes?: { bracketedPasteMode?: boolean } }> }).__vrykellTerms;
    return [...terms.values()].some(term => term.modes?.bracketedPasteMode === true);
  })).toBe(true);
  await page.evaluate(() => {
    (window as unknown as { __CLIPBOARD_TEXT__: string }).__CLIPBOARD_TEXT__ = 'line one\nline two';
  });
  await input.press('Control+v');
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __PTY_WRITES__: string[] }).__PTY_WRITES__))
    .toContain('\x1b[200~line one\rline two\x1b[201~');
});


test('running SSH blocks paste with their own bracketed mode', async ({ page }) => {
  await setupTauriMock(page, { sshHost: 'known' });
  await page.addInitScript(() => localStorage.setItem('vrykell-agent-settings', JSON.stringify({ version: 8, state: { global: { sshOpenMode: 'block' }, overrides: {} } })));
  await page.goto('/');
  await page.locator('[data-dock-btn="ssh"]').click();
  await page.getByTestId('ssh-row-ssh-1').dblclick();
  await expect(page.getByTestId('ssh-connection-input')).toBeHidden();
  await emitPtyOutput(page, `\x1b]133;E;${btoa('read input')}\x07\x1b]133;C\x07`);
  const host = page.getByTestId('running-term');
  await expect(host.locator('.xterm')).toBeVisible();
  await emitPtyOutput(page, '\x1b[?2004h');
  // Wait for xterm to parse the mode before pasting into the running program.
  await page.waitForFunction(() => {
    const terms = (window as unknown as { __vrykellTerms: Map<string, { modes: { bracketedPasteMode: boolean } }> }).__vrykellTerms;
    return [...terms.entries()].some(([key, term]) => key.startsWith('block:') && term.modes.bracketedPasteMode);
  });
  await page.evaluate(() => {
    (window as unknown as { __CLIPBOARD_TEXT__: string }).__CLIPBOARD_TEXT__ = 'line one\nline two';
  });
  await host.locator('.xterm-helper-textarea').press('Control+v');
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __PTY_WRITES__: string[] }).__PTY_WRITES__))
    .toContain('\x1b[200~line one\rline two\x1b[201~');
});


test('an explicitly disabled jump remains direct after saving and connecting', async ({ page }) => {
  await setupTauriMock(page, { sshHost: 'known' });
  await page.goto('/');
  await page.locator('[data-dock-btn="ssh"]').click();
  await page.getByTestId('ssh-new-btn').click();
  await page.getByTestId('ssh-form-name').fill('direct');
  await page.getByTestId('ssh-form-host').fill('direct.example.com');
  await page.getByTestId('ssh-form-jump').fill('none');
  await page.getByTestId('ssh-save-btn').click();
  await page.locator('[data-testid^="ssh-row-"]').filter({ hasText: 'direct' }).click({ button: 'right' });
  await page.getByRole('button', { name: '编辑连接', exact: true }).click();
  await expect(page.getByTestId('ssh-form-jump')).toHaveValue('none');
  await page.getByTestId('ssh-test-btn').click();
  await expect(page.getByTestId('ssh-host-editor').getByText(/认证成功/)).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.locator('[data-testid^="ssh-row-"]').filter({ hasText: 'direct' }).dblclick();
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __PTY_SPAWNS__: { ssh?: { jumpHost?: string } }[] }).__PTY_SPAWNS__.filter(spawn => spawn.ssh).map(spawn => spawn.ssh?.jumpHost)))
    .toEqual(['none']);
});
