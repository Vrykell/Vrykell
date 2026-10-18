/**
 * 设置页 e2e：模型配置（服务商芯片条 + API Key + 按服务商过滤的模型列表）。
 *
 * 种子数据：m-main（主力模型，Anthropic 端点）在前，m-local（本地模型，
 * OpenAI 兼容 @ 127.0.0.1:11434）在后且为当前生效模型；mock 只预置了
 * openai-compatible 的密钥。
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock, aiKeyCalls, aiModelCalls, clipboardText } from './tauri-mock';
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
    // 编辑密钥 → 展开替换输入框并聚焦
    await menu.getByText('编辑密钥').click();
    await expect(page.getByLabel('服务商 API Key')).toBeFocused();
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

  test('API Key：按服务商配置，掩码显示、查看/复制/清除、保存恢复', async ({ page }) => {
    // 默认第一行（Anthropic 端点）没有密钥：直接是输入框，检测不可用
    const keyField = fieldOf(page, '服务商 API Key');
    await expect(keyField.getByPlaceholder('输入 API Key')).toBeVisible();
    await expect(keyField.getByTestId('provider-check')).toBeDisabled();
    // 本地那个 OpenAI 兼容端点已配置：掩码 + 查看/复制
    const chips = page.locator('.settings-provider-chip');
    await chips.nth(1).click();
    await expect(keyField.getByTestId('provider-key-value')).toHaveText('sk-********abcd');
    await keyField.getByTestId('provider-key-reveal').click();
    await expect(keyField.getByTestId('provider-key-value')).toHaveText('sk-test-key-1234abcd');
    await keyField.getByTestId('provider-key-reveal').click();
    await expect(keyField.getByTestId('provider-key-value')).toHaveText('sk-********abcd');
    await keyField.getByTestId('provider-key-copy').click();
    expect(await clipboardText(page)).toBe('sk-test-key-1234abcd');
    // 清除 → 回到输入框
    await keyField.getByTestId('provider-key-clear').click();
    await expect(keyField.getByPlaceholder('输入 API Key')).toBeVisible();
    const clears = await aiKeyCalls(page);
    expect(clears.some((c) => c.provider === 'openai-compatible' && !c.key)).toBe(true);
    // 重新保存 → 掩码回来
    await keyField.getByPlaceholder('输入 API Key').fill('sk-e2e-key');
    await keyField.getByPlaceholder('输入 API Key').press('Enter');
    await expect(keyField.getByTestId('provider-key-value')).toBeVisible();
    const calls = await aiKeyCalls(page);
    expect(calls.some((c) => c.provider === 'openai-compatible' && c.key === 'sk-e2e-key')).toBe(true);
  });

  test('端点与连接：预览行、检测、同步模型', async ({ page }) => {
    // 预览行给出请求真正到达的地址
    await expect(page.getByTestId('provider-endpoint-preview')).toContainText('https://api.anthropic.com/v1/messages');
    // 本地端点已配置密钥：检测走模型列表请求并回报数量
    await page.locator('.settings-provider-chip').nth(1).click();
    await page.getByTestId('provider-check').click();
    await expect(page.getByRole('status').filter({ hasText: '连接正常' })).toBeVisible();
    // 同步把端点新增的模型并入列表
    const before = await page.getByTestId('model-name').count();
    await page.getByTestId('model-sync').click();
    await expect(page.getByRole('status').filter({ hasText: '已新增' })).toBeVisible();
    expect(await page.getByTestId('model-name').count()).toBeGreaterThan(before);
  });

  test('模型列表：按服务商过滤，设为当前、添加/改名/删除', async ({ page }) => {
    const chips = page.locator('.settings-provider-chip');
    const names = page.getByTestId('model-name');
    // 默认（Anthropic 行）只显示主力模型
    await expect(names).toHaveCount(1);
    await expect(names.first()).toHaveText('主力模型');
    // 本地端点行显示本地模型，而它是当前生效模型
    await chips.nth(1).click();
    await expect(names).toHaveCount(1);
    await expect(names.first()).toHaveText('本地模型');
    await expect(page.getByTestId('model-row').first().getByText('当前', { exact: true })).toBeVisible();
    // 回到 Anthropic 行，把主力模型设为当前
    await chips.first().click();
    const mainRow = page.getByTestId('model-row').first();
    await mainRow.getByRole('button', { name: '设为当前' }).click();
    await expect(mainRow.getByText('当前', { exact: true })).toBeVisible();
    const activeCalls = await aiModelCalls(page);
    expect(activeCalls.some((c) => c.kind === 'set_active' && c.id === 'm-main')).toBe(true);
    // 添加模型 → 该服务商多一行；齿轮展开后改名提交
    await page.getByTestId('model-add').click();
    await expect(names).toHaveCount(2);
    const newRow = page.getByTestId('model-row').nth(1);
    await newRow.getByTestId('model-settings').click();
    const nameInput = newRow.getByPlaceholder('模型名称');
    await nameInput.fill('新模型');
    await nameInput.press('Enter');
    await expect(page.locator('.settings-page-header').getByRole('status')).toHaveText('已保存');
    await expect(newRow.getByTestId('model-name')).toHaveText('新模型');
    const setModels = await aiModelCalls(page);
    const addCall = setModels.filter((c) => c.kind === 'set_models').pop();
    expect(addCall?.models).toHaveLength(3);
    expect((addCall?.models as { name: string }[])[2]?.name).toBe('新模型');
    // 删除新模型 → 回一行
    await newRow.getByTestId('model-remove').click();
    await expect(page.getByTestId('model-name')).toHaveCount(1);
  });

  test('添加服务商：预设落盘为新行并选中该服务商', async ({ page }) => {
    const chips = page.locator('.settings-provider-chip');
    await page.getByTestId('provider-add').click();
    await page.getByTestId('model-preset-DeepSeek').click();
    await expect(chips).toHaveCount(3);
    const deepseek = chips.filter({ hasText: 'DeepSeek' });
    await expect(deepseek).toHaveAttribute('aria-current', 'true');
    await expect(page.getByTestId('model-name')).toHaveCount(1);
    await expect(page.getByTestId('model-name')).toHaveText('DeepSeek');
  });

  test('服务商选择跨重载保持（lastSelectedProvider）', async ({ page }) => {
    await page.locator('.settings-provider-chip').nth(1).click();
    await page.reload();
    await openSettings(page);
    await expect(page.locator('.settings-provider-chip').nth(1)).toHaveAttribute('aria-current', 'true');
  });
});
