import { expect, test, type Page } from '@playwright/test';
import { emitPtyOutput, ptyWrites, setupTauriMock, waitForWorkbench } from './tauri-mock';
import { gotoSetting } from './settings';

async function openApp(page: Page, theme: 'dark' | 'light' = 'dark') {
  await setupTauriMock(page, { integration: false, launchDirectory: '/home/e2e/project', terminalDirectories: true });
  await page.addInitScript(theme => {
    localStorage.setItem('vrykell-theme-mode', theme);
    localStorage.setItem('mock-command-history-runs', JSON.stringify([
      { id: 'input-contract', target: 'local', shell: 'system', command: 'pwd', cwd: '/home/e2e/project', status: 'success', exitCode: 0, timestamp: 1000, runCount: 1 },
    ]));
  }, theme);
  await page.goto('/');
  await waitForWorkbench(page);
}

for (const [theme, width] of [['dark', 1240], ['light', 720]] as const) {
  test(`long message and configuration fields stay bounded in ${theme} at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 800 });
    await openApp(page, theme);
    await page.getByRole('button', { name: '版本控制', exact: true }).click();
    const message = page.getByTestId('git-panel').getByRole('textbox', { name: '提交信息' });
    await expect(message).toBeVisible();
    await expect(message).toHaveCSS('resize', 'none');
    const initialHeight = (await message.boundingBox())!.height;
    const long = Array.from({ length: 40 }, (_, index) => `Message line ${index + 1}`).join('\n');
    await message.fill(long);
    await expect.poll(async () => (await message.boundingBox())!.height).toBeGreaterThan(initialHeight);
    expect((await message.boundingBox())!.height).toBeLessThanOrEqual(181);
    await expect(message).toHaveCSS('overflow-y', 'auto');
    await message.press('Control+End');
    expect(await message.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await expect(message).toHaveValue(long);
    await page.getByTestId('git-panel').screenshot({ path: info.outputPath(`commit-input-${theme}.png`), animations: 'disabled' });
    await message.fill('short');
    await expect.poll(async () => (await message.boundingBox())!.height).toBeLessThanOrEqual(initialHeight + 1);
    await gotoSetting(page, '模型行为');
    const prompt = page.getByRole('textbox', { name: '系统提示词', exact: true });
    await prompt.fill(long);
    await expect(prompt).toHaveCSS('resize', 'none');
    await expect(prompt).toHaveCSS('overflow-y', 'auto');
    expect((await prompt.boundingBox())!.height).toBeLessThanOrEqual(321);
    await prompt.press('Control+End');
    expect(await prompt.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await expect(prompt).toHaveValue(long);
    await prompt.screenshot({ path: info.outputPath(`configuration-input-${theme}.png`), animations: 'disabled' });
    await prompt.fill('short prompt');
    await expect(page.locator('.settings-page-header').getByRole('status')).toHaveText('已保存');
  });
}

test('project root submission uses application validation instead of native validation bubbles', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: '历史命令', exact: true }).click();
  await page.getByTestId('command-history-panel').getByRole('button', { name: '设置项目根目录', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '设置项目根目录', exact: true });
  const root = dialog.getByRole('textbox', { name: '项目根目录', exact: true });
  await root.fill('   ');
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  await root.fill('/home/e2e');
  await root.evaluate(element => (element as HTMLInputElement).setCustomValidity('Native validation fixture'));
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('command-history-panel').getByRole('button', { name: '设置项目根目录', exact: true })).toHaveText('/home/e2e');
});

test('SSH response submission bypasses native validation and reaches the active terminal', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('workspace-area-ssh').click();
  await page.getByTestId('ssh-row-ssh-1').dblclick();
  await expect(page.getByTestId('ssh-terminal-screen')).toBeVisible();
  await emitPtyOutput(page, "\x1b[2J\x1b[Hroot@server's password:");
  const response = page.getByLabel('SSH 认证响应', { exact: true });
  await response.fill('temporary-validation-fixture');
  await response.evaluate(element => (element as HTMLInputElement).setCustomValidity('Native validation fixture'));
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(() => ptyWrites(page)).toContain('temporary-validation-fixture\r');
});
