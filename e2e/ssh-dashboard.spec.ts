import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test('SSH opens on the resource dashboard and metric toggles pause collection', async ({ page }, info) => {
  await setupTauriMock(page, { schedulesSeed: [], sshWorkspaceView: 'dashboard' });
  await page.goto('/');
  await page.getByTestId('workspace-area-ssh').click();
  const dashboard = page.getByTestId('ssh-dashboard');
  await expect(dashboard).toBeVisible();
  await expect(dashboard.getByRole('heading', { name: '资源仪表盘' })).toBeVisible();
  const host = dashboard.getByTestId('ssh-dashboard-host-ssh-1');
  await expect(host).toBeVisible();
  await expect.poll(() => page.evaluate(() => Number((window as unknown as Record<string, unknown>).__SSH_STATUS_CALLS__ ?? 0))).toBeGreaterThan(0);

  await host.click();
  const details = page.getByRole('dialog', { name: '主机详情' });
  await expect(details).toBeVisible();
  await expect(details.getByRole('button', { name: '打开终端', exact: true })).toBeVisible();
  await details.getByRole('button', { name: '关闭', exact: true }).click();
  await page.screenshot({ path: info.outputPath('ssh-resource-dashboard.png'), animations: 'disabled' });
  await dashboard.getByRole('button', { name: '表格视图', exact: true }).click();
  await expect(dashboard.locator('.ssh-dashboard-table')).toBeVisible();
  await dashboard.getByRole('button', { name: '卡片视图', exact: true }).click();
  await expect(host).toBeVisible();

  await page.getByTestId('workspace-area-terminal').click();
  await page.waitForTimeout(300);
  const inactiveCalls = await page.evaluate(() => Number((window as unknown as Record<string, unknown>).__SSH_STATUS_CALLS__ ?? 0));
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => Number((window as unknown as Record<string, unknown>).__SSH_STATUS_CALLS__ ?? 0))).toBe(inactiveCalls);
  await page.getByTestId('workspace-area-ssh').click();

  for (let index = 0; index < 7; index++) {
    const menu = page.getByRole('menu', { name: '采集并显示' });
    if (!await menu.isVisible()) await page.getByTestId('ssh-dashboard-metrics').click();
    await menu.getByRole('menuitemcheckbox').nth(index).click();
  }
  await expect(page.getByText('指标采集已暂停。开启至少一个指标后才会采集主机状态。', { exact: true })).toBeVisible();
  await page.waitForTimeout(200);
  const calls = await page.evaluate(() => Number((window as unknown as Record<string, unknown>).__SSH_STATUS_CALLS__ ?? 0));
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => Number((window as unknown as Record<string, unknown>).__SSH_STATUS_CALLS__ ?? 0))).toBe(calls);
  await page.keyboard.press('Escape');

  await page.getByTestId('ssh-manage-hosts').click();
  await expect(page.getByTestId('ssh-search')).toBeVisible();
  await expect(page.getByTestId('ssh-new-btn')).toBeVisible();
  await expect(page.getByTestId('ssh-row-ssh-1')).toBeVisible();
  await page.getByTestId('ssh-dashboard-open').click();
  await expect(page.getByTestId('ssh-dashboard')).toBeVisible();
});
