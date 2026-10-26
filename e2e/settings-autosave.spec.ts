import { test, expect } from '@playwright/test';
import { setupTauriMock, aiModelCalls } from './tauri-mock';
import { gotoSetting } from './settings';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
});

test('numeric feedback shows the actual saved value after bounds and rounding', async ({ page }) => {
  await gotoSetting(page, '模型行为');
  const steps = page.getByRole('spinbutton').first();
  for (const [draft, saved] of [['101', '100'], ['0', '1'], ['3.6', '4']]) {
    await steps.fill(draft);
    await expect(page.locator('.settings-page-header').getByRole('status')).toHaveText('已保存');
    await expect(steps).toHaveValue(saved);
  }
  await page.locator('aside').getByRole('button', { name: '主题', exact: true }).click();
  await page.locator('aside').getByRole('button', { name: '模型行为', exact: true }).click();
  await expect(page.getByRole('spinbutton').first()).toHaveValue('4');
});

test('model text waits for a pause and the last write carries the whole row', async ({ page }) => {
  await gotoSetting(page, '模型配置');
  // 地址在端点卡片里，先落盘
  await page.getByTestId('provider-endpoint-input').fill('https://new.example/v1');
  await expect(page.locator('.settings-page-header').getByRole('status')).toHaveText('已保存');
  const before = (await aiModelCalls(page)).length;
  // 名称在行编辑（齿轮）里，停顿后单独落盘并带上已保存的地址
  await page.getByTestId('model-settings').first().click();
  const name = page.getByTestId('model-settings-dialog').getByPlaceholder('模型名称');
  await name.fill('新的模型名称');
  await expect(page.locator('.settings-page-header').getByRole('status')).toHaveText('待保存…');
  expect((await aiModelCalls(page)).length).toBe(before);
  await expect(page.locator('.settings-page-header').getByRole('status')).toHaveText('已保存');
  const last = (await aiModelCalls(page)).filter(call => call.kind === 'set_models').at(-1)!;
  expect((last.models as { name: string; baseUrl: string }[])[0]).toMatchObject({ name: '新的模型名称', baseUrl: 'https://new.example/v1' });
  await expect(page.getByRole('button', { name: '保存', exact: true })).toHaveCount(0);
});

test('switching pages flushes pending text and scopes local and remote editors separately', async ({ page }) => {
  await gotoSetting(page, '本地文件打开方式');
  await page.getByTestId('editor-local-command').fill('code');
  await page.locator('aside').getByRole('button', { name: '远程文件打开方式', exact: true }).click();
  await expect(page.getByTestId('editor-remote-command')).toHaveValue('vim');
  await page.getByTestId('editor-remote-command').fill('nvim');
  await page.locator('aside').getByRole('button', { name: '本地文件打开方式', exact: true }).click();
  await expect(page.getByTestId('editor-local-command')).toHaveValue('code');
  await page.locator('aside').getByRole('button', { name: '远程文件打开方式', exact: true }).click();
  await expect(page.getByTestId('editor-remote-command')).toHaveValue('nvim');
});

test('save failures keep the draft visible and allow retry', async ({ page }) => {
  await page.evaluate(() => {
    const bridge = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const original = bridge.invoke;
    let fail = true;
    bridge.invoke = (command, args) => {
      if (command === 'set_ai_models' && fail) { fail = false; return Promise.reject(new Error('offline')); }
      return original(command, args);
    };
  });
  await gotoSetting(page, '模型配置');
  // 名称在行编辑（齿轮）里
  await page.getByTestId('model-settings').first().click();
  const name = page.getByPlaceholder('模型名称').first();
  await name.fill('失败时保留的草稿');
  const field = name.locator('xpath=..');
  await expect(field.getByRole('status')).toContainText('保存失败');
  await expect(name).toHaveValue('失败时保留的草稿');
  await field.getByRole('button', { name: '重试' }).click();
  await expect(page.locator('.settings-page-header').getByRole('status')).toHaveText('已保存');
  const saved = (await aiModelCalls(page)).filter(call => call.kind === 'set_models').at(-1)!;
  expect((saved.models as { name: string }[])[0].name).toBe('失败时保留的草稿');
});
