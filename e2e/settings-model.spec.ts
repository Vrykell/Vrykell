/**
 * 设置页 e2e：模型配置（API Key + 模型列表）。
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock, aiKeyCalls, aiModelCalls } from './tauri-mock';
import { openSettings, fieldOf } from './settings';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await openSettings(page);
});

test.describe('模型配置页', () => {
  test('API Key：默认已配置，清除后未配置，再保存恢复', async ({ page }) => {
    // mock 默认预置 key，页面显示已配置
    const keyField = fieldOf(page, '服务商 API Key');
    await expect(keyField.getByText('已配置')).toBeVisible();
    // 清除
    await keyField.getByRole('button', { name: '清除' }).click();
    await expect(keyField.getByText('未配置')).toBeVisible();
    const clears = await aiKeyCalls(page);
    expect(clears.some((c) => c.provider === 'openai-compatible' && !c.key)).toBe(true);
    // 重新保存
    await keyField.getByPlaceholder('输入 API Key').fill('sk-e2e-key');
    await keyField.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('已保存 API Key')).toBeVisible();
    await expect(keyField.getByText('已配置')).toBeVisible();
    const calls = await aiKeyCalls(page);
    expect(calls.some((c) => c.provider === 'openai-compatible' && c.key === 'sk-e2e-key')).toBe(true);
  });

  test('模型列表：两个预置模型、设为当前、添加/改名/删除', async ({ page }) => {
    // 两个模型卡（名称在 input value 里）
    const nameInputs = page.getByPlaceholder('模型名称');
    await expect(nameInputs).toHaveCount(2);
    await expect(nameInputs.nth(0)).toHaveValue('主力模型');
    await expect(nameInputs.nth(1)).toHaveValue('本地模型');

    // 把本地模型设为当前（第二张卡的按钮）
    const localCard = nameInputs.nth(1).locator('xpath=../..');
    await localCard.getByRole('button', { name: '设为当前' }).click();
    await expect(localCard.getByText('当前')).toBeVisible();
    const activeCalls = await aiModelCalls(page);
    expect(activeCalls.some((c) => c.kind === 'set_active' && c.id === 'm-local')).toBe(true);

    // 添加模型 → 第 3 个卡，改名提交
    await page.getByRole('button', { name: /添加模型/ }).click();
    await expect(nameInputs).toHaveCount(3);
    await nameInputs.nth(2).fill('新模型');
    await nameInputs.nth(2).press('Enter');
    await expect(nameInputs.nth(2)).toHaveValue('新模型');
    const setModels = await aiModelCalls(page);
    const addCall = setModels.filter((c) => c.kind === 'set_models').pop();
    expect(addCall?.models).toHaveLength(3);
    expect((addCall?.models as { name: string }[])[2]?.name).toBe('新模型');

    // 删除新模型 → 回 2 个
    const newCard = nameInputs.nth(2).locator('xpath=../..');
    await newCard.getByTitle('删除模型').click();
    await expect(page.getByPlaceholder('模型名称')).toHaveCount(2);
  });

  test('设置搜索：输入关键词过滤侧栏项', async ({ page }) => {
    const searchBox = page.locator('aside').getByPlaceholder('搜索设置…');
    await searchBox.fill('技能');
    await expect(page.locator('aside').getByRole('button', { name: '技能', exact: true })).toBeVisible();
    await expect(page.locator('aside').getByRole('button', { name: '模型配置', exact: true })).toHaveCount(0);
    await searchBox.fill('不存在的设置');
    await expect(page.getByText('无匹配设置')).toBeVisible();
  });
});
