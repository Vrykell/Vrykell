import { expect, test } from '@playwright/test';
import { setupTauriMock, acpCalls } from './tauri-mock';

test('moves a connected agent into the common workspace and retains its guarded close', async ({ page }) => {
  await setupTauriMock(page, { schedulesSeed: [] }); await page.goto('/');
  await page.getByTestId('workspace-area-ai').click(); await page.getByTestId('harness-add-session').click();
  await page.getByTestId('acp-launcher-Fake ACP').click();
  const input = page.locator('[data-testid="harness-page"]:visible').getByTestId('harness-composer');
  await input.fill('Do not discard this agent draft'); const original = await input.elementHandle();
  const before = (await acpCalls(page)).filter(call => call.startsWith('acp_open:')).length;
  await page.getByTestId('workspace-instance-bar').getByTestId('workspace-resource-switcher').click();
  await page.getByRole('menuitem', { name: '聚合工作区', exact: true }).click();
  const strip = page.getByTestId('workspace-instance-bar').getByRole('tablist');
  await strip.getByRole('tab', { name: 'Fake ACP', exact: true }).click();
  await expect(page.getByTestId('unified-workspace').getByTestId('harness-composer')).toHaveValue('Do not discard this agent draft');
  expect(await original!.evaluate(element => element.isConnected)).toBe(true);
  await page.keyboard.press('Control+w');
  const dialog = page.getByRole('dialog', { name: '关闭 ACP 会话？' }); await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '取消', exact: true }).click(); await expect(input).toHaveValue('Do not discard this agent draft');
  expect((await acpCalls(page)).filter(call => call.startsWith('acp_open:')).length).toBe(before);
});
