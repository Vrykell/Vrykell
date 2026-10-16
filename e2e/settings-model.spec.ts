/**
 * 设置页 e2e：模型配置（服务商芯片条 + API Key + 按服务商过滤的模型列表）。
 *
 * 种子数据：m-main（主力模型，Anthropic 端点）在前，m-local（本地模型，
 * OpenAI 兼容 @ 127.0.0.1:11434）在后且为当前生效模型；mock 只预置了
 * openai-compatible 的密钥。
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
  test('服务商条：默认选中、切换选中、⋯ 菜单三项', async ({ page }) => {
    const chips = page.locator('.settings-provider-chip');
    await expect(chips).toHaveCount(2);
    await expect(chips.first()).toHaveAttribute('aria-current', 'true');
    await chips.nth(1).click();
    await expect(chips.nth(1)).toHaveAttribute('aria-current', 'true');
    await expect(chips.first()).not.toHaveAttribute('aria-current', 'true');
    // 右侧详情头部的 ⋯ 菜单
    await page.locator('.settings-content').getByLabel('更多操作').click();
    const menu = page.getByRole('menu');
    await expect(menu.getByText('设为当前')).toBeVisible();
    await expect(menu.getByText('编辑密钥')).toBeVisible();
    await expect(menu.getByText('删除服务商')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
  });

  test('⋯ 删除服务商：移除其模型行；只剩一个时拒绝', async ({ page }) => {
    const chips = page.locator('.settings-provider-chip');
    await page.locator('.settings-content').getByLabel('更多操作').click();
    await page.getByRole('menu').getByText('删除服务商').click();
    await expect(chips).toHaveCount(1);
    await expect(chips.first()).toContainText('127.0.0.1');
    const setModels = await aiModelCalls(page);
    const last = setModels.filter((call) => call.kind === 'set_models').pop();
    expect(last?.models).toHaveLength(1);
    // 保底：最后一个服务商不可删
    await page.locator('.settings-content').getByLabel('更多操作').click();
    await page.getByRole('menu').getByText('删除服务商').click();
    await expect(page.getByText('至少保留一个模型')).toBeVisible();
    await expect(chips).toHaveCount(1);
  });

  test('API Key：按服务商配置，清除后未配置，再保存恢复', async ({ page }) => {
    // 默认第一行（Anthropic 端点）没有密钥；预置密钥属于本地那个 OpenAI 兼容端点
    const chips = page.locator('.settings-provider-chip');
    await expect(fieldOf(page, '服务商 API Key').getByText('未配置')).toBeVisible();
    await chips.nth(1).click();
    const keyField = fieldOf(page, '服务商 API Key');
    await expect(keyField.getByText('已配置')).toBeVisible();
    // 清除
    await keyField.getByRole('button', { name: '清除' }).click();
    await expect(keyField.getByText('未配置')).toBeVisible();
    const clears = await aiKeyCalls(page);
    expect(clears.some((c) => c.provider === 'openai-compatible' && !c.key)).toBe(true);
    // 重新保存
    await keyField.getByPlaceholder('输入 API Key').fill('sk-e2e-key');
    await expect(page.locator('.settings-page-header').getByRole('status')).toHaveText('已保存');
    await expect(keyField.getByText('已配置')).toBeVisible();
    const calls = await aiKeyCalls(page);
    expect(calls.some((c) => c.provider === 'openai-compatible' && c.key === 'sk-e2e-key')).toBe(true);
  });

  test('模型列表：按服务商过滤，设为当前、添加/改名/删除', async ({ page }) => {
    const chips = page.locator('.settings-provider-chip');
    const nameInputs = page.getByPlaceholder('模型名称');
    // 默认（Anthropic 行）只显示主力模型
    await expect(nameInputs).toHaveCount(1);
    await expect(nameInputs.first()).toHaveValue('主力模型');
    // 本地端点行显示本地模型，而它是当前生效模型
    await chips.nth(1).click();
    await expect(nameInputs).toHaveCount(1);
    await expect(nameInputs.first()).toHaveValue('本地模型');
    await expect(nameInputs.first().locator('xpath=../../..').getByText('当前')).toBeVisible();
    // 回到 Anthropic 行，把主力模型设为当前
    await chips.first().click();
    const mainCard = nameInputs.first().locator('xpath=../../..');
    await mainCard.getByRole('button', { name: '设为当前' }).click();
    await expect(mainCard.getByText('当前')).toBeVisible();
    const activeCalls = await aiModelCalls(page);
    expect(activeCalls.some((c) => c.kind === 'set_active' && c.id === 'm-main')).toBe(true);
    // 添加模型 → 该服务商多一张卡，改名提交
    await page.getByRole('button', { name: /添加模型/ }).click();
    await expect(nameInputs).toHaveCount(2);
    await nameInputs.nth(1).fill('新模型');
    await nameInputs.nth(1).press('Enter');
    await expect(page.locator('.settings-page-header').getByRole('status')).toHaveText('已保存');
    await expect(nameInputs.nth(1)).toHaveValue('新模型');
    const setModels = await aiModelCalls(page);
    const addCall = setModels.filter((c) => c.kind === 'set_models').pop();
    expect(addCall?.models).toHaveLength(3);
    expect((addCall?.models as { name: string }[])[2]?.name).toBe('新模型');
    // 删除新模型 → 回一张卡
    const newCard = nameInputs.nth(1).locator('xpath=../../..');
    await newCard.locator('[data-tip="删除模型"]').click();
    await expect(page.getByPlaceholder('模型名称')).toHaveCount(1);
  });

  test('添加服务商：预设落盘为新行并选中该服务商', async ({ page }) => {
    const chips = page.locator('.settings-provider-chip');
    await page.getByTestId('provider-add').click();
    await page.getByTestId('model-preset-DeepSeek').click();
    await expect(chips).toHaveCount(3);
    const deepseek = chips.filter({ hasText: 'DeepSeek' });
    await expect(deepseek).toHaveAttribute('aria-current', 'true');
    await expect(page.getByPlaceholder('模型名称')).toHaveCount(1);
    await expect(page.getByPlaceholder('模型名称')).toHaveValue('DeepSeek');
  });

  test('服务商选择跨重载保持（lastSelectedProvider）', async ({ page }) => {
    await page.locator('.settings-provider-chip').nth(1).click();
    await page.reload();
    await openSettings(page);
    await expect(page.locator('.settings-provider-chip').nth(1)).toHaveAttribute('aria-current', 'true');
  });
});
