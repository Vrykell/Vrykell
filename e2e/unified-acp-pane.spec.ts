import { expect, test } from '@playwright/test';
import { setupTauriMock, acpCalls } from './tauri-mock';
import { pickPlacementZone } from './placement';

test('uses the shared split picker from the agent workspace and creates a distinct agent only after placement', async ({ page }) => {
  await setupTauriMock(page, {}); await page.goto('/');
  await page.getByTestId('workspace-area-ai').click(); await page.getByTestId('harness-add-session').click();
  await page.getByTestId('acp-launcher-Fake ACP').click();
  await page.locator('[data-testid="harness-page"]:visible').getByTestId('harness-composer').fill('first agent draft');
  const before = (await acpCalls(page)).filter(call => call.startsWith('acp_open:')).length;
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: '拆分标签页' }).click();
  await page.getByRole('menuitem', { name: 'ACP 智能体', exact: true }).click();
  await expect(page.getByRole('menu', { name: '选择分屏标签', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'ACP', exact: true })).toBeVisible();
  await page.locator('[data-testid="acp-launcher-Fake ACP"]:visible').click();
  await expect(page.getByTestId('placement-overlay')).toBeVisible();
  expect((await acpCalls(page)).filter(call => call.startsWith('acp_open:')).length).toBe(before);
  const mixed = page.getByTestId('pane-workspace-ai'); await pickPlacementZone(page, mixed.locator('.unified-pane').first(), 'right');
  await expect(mixed.getByTestId('harness-composer')).toHaveCount(2);
  const drafts = mixed.getByTestId('harness-composer'); await drafts.last().fill('second agent draft');
  await expect(drafts.first()).toHaveValue('first agent draft'); await expect(drafts.last()).toHaveValue('second agent draft');
  await expect(page.locator('.workspace-layout')).toHaveAttribute('data-area', 'ai');
  await mixed.getByTestId('harness-page').last().click({ button: 'right', position: { x: 90, y: 90 } });
  await page.getByRole('menu', { name: '窗格操作', exact: true }).getByRole('menuitem', { name: '移除此分屏', exact: true }).click();
  await expect(page.locator('[data-testid="harness-page"]:visible')).toHaveCount(1);
  expect((await acpCalls(page)).filter(call => call.startsWith('acp_open:')).length).toBe(before + 1);
});

test('moves a connected agent into the common workspace and retains its guarded close', async ({ page }) => {
  await setupTauriMock(page, {}); await page.goto('/');
  await page.getByTestId('workspace-area-ai').click(); await page.getByTestId('harness-add-session').click();
  await page.getByTestId('acp-launcher-Fake ACP').click();
  const input = page.locator('[data-testid="harness-page"]:visible').getByTestId('harness-composer');
  await input.fill('Do not discard this agent draft'); const original = await input.elementHandle();
  const before = (await acpCalls(page)).filter(call => call.startsWith('acp_open:')).length;
  await page.getByTestId('workspace-area-unified').click();
  const strip = page.getByTestId('workspace-instance-bar').getByRole('tablist');
  await strip.getByRole('tab', { name: 'Fake ACP', exact: true }).click();
  await expect(page.getByTestId('unified-workspace').getByTestId('harness-composer')).toHaveValue('Do not discard this agent draft');
  expect(await original!.evaluate(element => element.isConnected)).toBe(true);
  await page.keyboard.press('Control+w');
  const dialog = page.getByRole('dialog', { name: '关闭 ACP 会话？' }); await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '取消', exact: true }).click(); await expect(input).toHaveValue('Do not discard this agent draft');
  expect((await acpCalls(page)).filter(call => call.startsWith('acp_open:')).length).toBe(before);
});
