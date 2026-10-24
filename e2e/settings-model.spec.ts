/**
 * 设置页 e2e：模型配置（服务商切换按钮 + 中央浮层 + API Key + 端点 + 模型列表）。
 *
 * 种子数据：m-main（主力模型，Anthropic 端点）在前，m-local（本地模型，
 * OpenAI 兼容 @ 127.0.0.1:11434）在后且为当前生效模型；mock 只预置了本地端点的密钥。
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock, aiKeyCalls, aiModelCalls, clipboardText } from './tauri-mock';
import { openSettings, fieldOf } from './settings';

const LOCAL_ID = 'openai-compatible|http://127.0.0.1:11434/v1';
const ANTHROPIC_ID = 'anthropic|https://api.anthropic.com/v1';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await openSettings(page);
});

test.describe('模型配置页', () => {
  test('服务商按钮：默认选中、中央浮层切换、添加动作与 ⋯ 菜单三项', async ({ page }) => {
    const switcher = page.getByTestId('provider-switch');
    await expect(switcher.locator('.provider-switch-name')).toHaveText('Anthropic');
    await switcher.click();
    const dialog = page.getByTestId('provider-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.locator('[data-testid^="provider-option-"]')).toHaveCount(2);
    await expect(page.getByTestId(`provider-option-${ANTHROPIC_ID}`)).toHaveAttribute('aria-current', 'true');
    // 添加服务商收在同一个浮层里
    await expect(page.getByTestId('provider-dialog-add')).toBeVisible();
    await page.getByTestId(`provider-option-${LOCAL_ID}`).click();
    await expect(dialog).toHaveCount(0);
    await expect(switcher.locator('.provider-switch-name')).toHaveText('127.0.0.1:11434');
    // 右侧详情头部的 ⋯ 菜单
    await page.locator('.settings-content').getByLabel('更多操作').click();
    const menu = page.getByRole('menu');
    await expect(menu.getByText('设为当前')).toBeVisible();
    await expect(menu.getByText('编辑密钥')).toBeVisible();
    await expect(menu.getByText('删除服务商')).toBeVisible();
    // 编辑密钥 → 中央浮层编辑器
    await menu.getByText('编辑密钥').click();
    await expect(page.getByTestId('key-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('key-dialog')).toHaveCount(0);
  });

  test('⋯ 删除服务商：先确认，移除其模型行；只剩一个时拒绝', async ({ page }) => {
    const switcher = page.getByTestId('provider-switch');
    await page.locator('.settings-content').getByLabel('更多操作').click();
    await page.getByRole('menu').getByText('删除服务商').click();
    await page.getByTestId('confirm-ok').click();
    await expect(switcher.locator('.provider-switch-name')).toHaveText('127.0.0.1:11434');
    const setModels = await aiModelCalls(page);
    const last = setModels.filter((call) => call.kind === 'set_models').pop();
    expect(last?.models).toHaveLength(1);
    // 保底：最后一个服务商不可删（不弹确认）
    await page.locator('.settings-content').getByLabel('更多操作').click();
    await page.getByRole('menu').getByText('删除服务商').click();
    await expect(page.getByText('至少保留一个模型')).toBeVisible();
    await expect(page.getByTestId('confirm-dialog')).toHaveCount(0);
  });

  test('API Key：按服务商各存各的，掩码显示、查看/复制/清除、保存恢复', async ({ page }) => {
    // 默认第一行（Anthropic 端点）没有密钥：显示「添加 API 密钥」入口，检测不可用
    const keyField = fieldOf(page, '服务商 API Key');
    await expect(keyField.getByTestId('provider-key-add')).toBeVisible();
    await expect(keyField.getByTestId('provider-key-add')).toContainText('添加 API 密钥');
    await expect(keyField.getByTestId('provider-check')).toBeDisabled();
    // 添加：中央浮层里输入，眼睛切换明文，保存并关闭
    await keyField.getByTestId('provider-key-add').click();
    const dialog = page.getByTestId('key-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('key-dialog-input').fill('sk-anthropic-key');
    await dialog.getByTestId('key-dialog-reveal').click();
    await expect(dialog.getByTestId('key-dialog-input')).toHaveAttribute('type', 'text');
    await dialog.getByTestId('key-dialog-reveal').click();
    await expect(dialog.getByTestId('key-dialog-input')).toHaveAttribute('type', 'password');
    await dialog.getByTestId('key-dialog-save').click();
    await expect(dialog).toHaveCount(0);
    await expect(keyField.getByTestId('provider-key-value')).toBeVisible();
    const savedKeys = await aiKeyCalls(page);
    expect(savedKeys.some((c) => c.provider === ANTHROPIC_ID && c.key === 'sk-anthropic-key')).toBe(true);
    // 切到本地端点：它有自己的密钥，掩码 + 查看/复制
    await page.getByTestId('provider-switch').click();
    await page.getByTestId(`provider-option-${LOCAL_ID}`).click();
    await expect(keyField.getByTestId('provider-key-value')).toHaveText('sk-********abcd');
    await keyField.getByTestId('provider-key-reveal').click();
    await expect(keyField.getByTestId('provider-key-value')).toHaveText('sk-test-key-1234abcd');
    await keyField.getByTestId('provider-key-reveal').click();
    await expect(keyField.getByTestId('provider-key-value')).toHaveText('sk-********abcd');
    await keyField.getByTestId('provider-key-copy').click();
    expect(await clipboardText(page)).toBe('sk-test-key-1234abcd');
    // 清除 → 回到添加入口
    await keyField.getByTestId('provider-key-clear').click();
    await expect(keyField.getByTestId('provider-key-add')).toBeVisible();
    const clears = await aiKeyCalls(page);
    expect(clears.some((c) => c.provider === LOCAL_ID && !c.key)).toBe(true);
    // 切回 Anthropic：它自己的密钥还在
    await page.getByTestId('provider-switch').click();
    await page.getByTestId(`provider-option-${ANTHROPIC_ID}`).click();
    await expect(keyField.getByTestId('provider-key-value')).toBeVisible();
  });

  test('端点与连接：预览行、检测、同步模型', async ({ page }) => {
    // 预览行给出请求真正到达的地址
    await expect(page.getByTestId('provider-endpoint-preview')).toContainText('https://api.anthropic.com/v1/messages');
    // 本地端点已配置密钥：检测走模型列表请求并回报数量
    await page.getByTestId('provider-switch').click();
    await page.getByTestId(`provider-option-${LOCAL_ID}`).click();
    await page.getByTestId('provider-check').click();
    await expect(page.getByRole('status').filter({ hasText: '连接正常' })).toBeVisible();
    // 同步把端点新增的模型并入列表
    const before = await page.getByTestId('model-name').count();
    await page.getByTestId('model-sync').click();
    await expect(page.getByRole('status').filter({ hasText: '已新增' })).toBeVisible();
    expect(await page.getByTestId('model-name').count()).toBeGreaterThan(before);
  });

  test('模型列表：按服务商过滤，设为当前、添加/改名/删除', async ({ page }) => {
    const names = page.getByTestId('model-name');
    // 默认（Anthropic 行）只显示主力模型
    await expect(names).toHaveCount(1);
    await expect(names.first()).toHaveText('主力模型');
    // 本地端点行显示本地模型，而它是当前生效模型
    await page.getByTestId('provider-switch').click();
    await page.getByTestId(`provider-option-${LOCAL_ID}`).click();
    await expect(names).toHaveCount(1);
    await expect(names.first()).toHaveText('本地模型');
    await expect(page.getByTestId('model-row').first().getByText('当前', { exact: true })).toHaveCount(0);
    // 回到 Anthropic 行：行内既没有「设为当前」，也没有「当前」提示
    await page.getByTestId('provider-switch').click();
    await page.getByTestId(`provider-option-${ANTHROPIC_ID}`).click();
    const mainRow = page.getByTestId('model-row').first();
    await expect(mainRow.getByRole('button', { name: '设为当前' })).toHaveCount(0);
    await expect(mainRow.getByText('当前', { exact: true })).toHaveCount(0);
    // 添加模型：中央表单填 ID（必填）与分组
    await page.getByTestId('model-add').click();
    const addDialog = page.getByTestId('add-model-dialog');
    await expect(addDialog).toBeVisible();
    // 空 ID 直接点「添加模型」→ 明确提示（而不是禁用无反馈）
    await addDialog.getByTestId('add-model-confirm').click();
    await expect(page.getByRole('status').filter({ hasText: '先填写模型 ID' })).toBeVisible();
    await addDialog.getByTestId('add-model-id').fill('deepseek-chat');
    await addDialog.getByTestId('add-model-group').fill('对话模型');
    await addDialog.getByTestId('add-model-confirm').click();
    await expect(addDialog).toHaveCount(0);
    await expect(names).toHaveCount(2);
    await expect(page.getByTestId('model-group-custom:对话模型')).toBeVisible();
    // 齿轮打开中央编辑器改名
    await page.getByTestId('model-row').nth(1).getByTestId('model-settings').click();
    const dialog = page.getByTestId('model-settings-dialog');
    await expect(dialog).toBeVisible();
    const nameInput = dialog.getByPlaceholder('模型名称');
    await nameInput.fill('新模型');
    await nameInput.press('Enter');
    await expect(page.locator('.settings-page-header').getByRole('status')).toHaveText('已保存');
    await dialog.getByTestId('model-settings-done').click();
    await expect(page.getByTestId('model-name').nth(1)).toHaveText('新模型');
    const setModels = await aiModelCalls(page);
    const addCall = setModels.filter((c) => c.kind === 'set_models').pop();
    expect(addCall?.models).toHaveLength(3);
    expect((addCall?.models as { name: string }[])[2]?.name).toBe('新模型');
    // 删除新模型：先确认 → 回一行
    await page.getByTestId('model-row').nth(1).getByTestId('model-remove').click();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('model-name')).toHaveCount(1);
  });

  test('添加服务商：同一浮层内切到预设网格，返回键可回到列表', async ({ page }) => {
    const switcher = page.getByTestId('provider-switch');
    await switcher.click();
    const dialog = page.getByTestId('provider-dialog');
    await expect(dialog).toBeVisible();
    await page.getByTestId('provider-dialog-add').click();
    // 预设网格出现在同一个浮层里，返回键回到服务商列表
    await expect(page.getByTestId('model-preset-DeepSeek')).toBeVisible();
    await page.getByTestId('dialog-back').click();
    await expect(page.getByTestId('model-preset-DeepSeek')).toHaveCount(0);
    await expect(page.locator('[data-testid^="provider-option-"]')).toHaveCount(2);
    // 再进一次并选中 DeepSeek：回到列表且新服务商已选中
    await page.getByTestId('provider-dialog-add').click();
    await page.getByTestId('model-preset-DeepSeek').click();
    await expect(page.getByTestId('model-preset-DeepSeek')).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(page.locator('[data-testid^="provider-option-"]')).toHaveCount(3);
    await page.getByTestId('dialog-close').click();
    await expect(dialog).toHaveCount(0);
    await expect(switcher.locator('.provider-switch-name')).toHaveText('DeepSeek');
    await expect(page.getByTestId('model-name')).toHaveCount(1);
    await expect(page.getByTestId('model-name')).toHaveText('DeepSeek');
  });

  test('OpenCode 预设：端点预览与请求路径来自目录数据', async ({ page }) => {
    await page.getByTestId('provider-switch').click();
    await page.getByTestId('provider-dialog-add').click();
    await page.getByTestId('model-preset-OpenCode Go').click();
    await page.getByTestId('dialog-close').click();
    await expect(page.getByTestId('provider-switch').locator('.provider-switch-name')).toHaveText('OpenCode Go');
    await expect(page.getByTestId('provider-endpoint-preview')).toContainText('https://opencode.ai/zen/go/v1/chat/completions');
  });

  test('服务商选择跨重载保持（lastSelectedProvider）', async ({ page }) => {
    await page.getByTestId('provider-switch').click();
    await page.getByTestId(`provider-option-${LOCAL_ID}`).click();
    await page.reload();
    await openSettings(page);
    await expect(page.getByTestId('provider-switch').locator('.provider-switch-name')).toHaveText('127.0.0.1:11434');
  });
});
