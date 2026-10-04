import { test, expect } from '@playwright/test';
import { setupTauriMock, mockAnthropic, searchCalls, ptyWrites, ptyResizes } from './tauri-mock';
import { gotoSetting } from './settings';

test('saved custom Anthropic address is used by the next chat request', async ({ page }) => {
  await setupTauriMock(page);
  await mockAnthropic(page, '地址设置已生效');
  await page.goto('/');
  await gotoSetting(page, '模型配置');
  const card = page.getByPlaceholder('模型名称').first().locator('xpath=../..');
  await card.getByRole('button', { name: 'Anthropic', exact: true }).click();
  await card.getByPlaceholder('服务地址 (Base URL)').fill('https://gateway.example/v1');
  await card.getByPlaceholder('服务地址 (Base URL)').press('Enter');
  await card.getByRole('button', { name: '设为当前' }).click();
  await page.locator('.settings-content input[type="password"]').fill('test-placeholder-key');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('已保存 API Key')).toBeVisible();
  const previousCalls = (await searchCalls(page)).length;
  await page.keyboard.press('Meta+1');
  await page.locator('[data-dock-btn="chat"]').click();
  await page.getByPlaceholder(/自然语言描述/).fill('验证地址');
  await page.getByPlaceholder(/自然语言描述/).press('Enter');
  await expect(page.getByText('地址设置已生效', { exact: true }).first()).toBeVisible();
  const calls = (await searchCalls(page)).slice(previousCalls).filter(call => call.cmd === 'llm_stream');
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.map(call => call.args.url)).toEqual(calls.map(() => 'https://gateway.example/v1/messages'));
});

