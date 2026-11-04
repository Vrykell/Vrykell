/**
 * Settings page e2e: model behavior (Agent / deep thinking / thinking level / context strategy / automatic titles + per-model overrides).
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { gotoSetting, fieldOf } from './settings';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await gotoSetting(page, '模型行为');
});

const settingsJson = (page: import('@playwright/test').Page) =>
  page.evaluate(() => localStorage.getItem('vrykell-agent-settings') ?? '');

test.describe('model behavior page', () => {
  test('Agent mode persists after toggling, and deep thinking moves to the model configuration', async ({ page }) => {
    const agentSwitch = fieldOf(page, 'Agent 模式').getByRole('switch');
    await expect(agentSwitch).toHaveAttribute('aria-checked', 'true');

    await agentSwitch.click();
    await expect(agentSwitch).toHaveAttribute('aria-checked', 'false');
    let saved = await settingsJson(page);
    expect(saved).toContain('"agentMode":false');

    await expect(page.locator('.settings-content').getByText('深度思考', { exact: true })).toHaveCount(0);
    await page.locator('aside').getByRole('button', { name: '模型配置', exact: true }).click();
    await page.getByTestId('model-settings').first().click();
    const thinking = page.getByLabel('主力模型的思考设置');
    await expect(thinking.getByText('已开启')).toHaveCount(0);
    await expect(thinking.getByText('已关闭')).toHaveCount(0);
    await expect(page.getByTestId('model-context-settings').getByText('已开启')).toHaveCount(0);
    await expect(page.getByTestId('model-context-settings').getByText('已关闭')).toHaveCount(0);
    expect(await page.getByTestId('model-context-settings').locator('input[type="number"]').first().evaluate(input => getComputedStyle(input).appearance)).toBe('textfield');
    const thinkSwitch = thinking.getByRole('switch');
    await thinkSwitch.click();
    await expect(thinkSwitch).toHaveAttribute('aria-checked', 'true');
    saved = await settingsJson(page);
    expect(saved).toContain('"deepThink":true');
    await expect(thinking.getByRole('combobox', { name: '主力模型的思考强度' })).toBeVisible();
  });

  test('thinking level switches to low and persists', async ({ page }) => {
    await page.locator('aside').getByRole('button', { name: '模型配置', exact: true }).click();
    await page.getByTestId('model-settings').first().click();
    const thinking = page.getByLabel('主力模型的思考设置');
    await thinking.getByRole('switch').click();
    await thinking.getByRole('combobox', { name: '主力模型的思考强度' }).click();
    await page.getByRole('option', { name: '低', exact: true }).click();
    const saved = await settingsJson(page);
    expect(saved).toContain('"thinkingLevel":"low"');
  });

  test('context strategy defaults globally and can be overridden per model', async ({ page }) => {
    const strategy = fieldOf(page, '上下文策略');
    await expect(strategy).toBeVisible();
    const defaultContext = page.getByTestId('default-configuration');
    await expect(defaultContext.locator('.settings-field')).toHaveCount(6);
    await expect(defaultContext.locator('.settings-field').nth(1)).toHaveCSS('border-top-width', '1px');
    await expect(defaultContext.getByText('已开启')).toHaveCount(0);
    await expect(defaultContext.getByText('已关闭')).toHaveCount(0);
    expect(await defaultContext.locator('input[type="number"]').first().evaluate(input => getComputedStyle(input).appearance)).toBe('textfield');
    await strategy.getByRole('combobox', { name: '上下文策略' }).click();
    await page.getByRole('option', { name: '窗口', exact: true }).click();
    let saved = await settingsJson(page);
    expect(saved).toContain('"contextStrategy":"window"');
    let state = JSON.parse(saved) as { state: { global: { contextStrategy: string }; overrides: Record<string, { contextStrategy?: string }> } };
    expect(state.state.global.contextStrategy).toBe('window');
    expect(state.state.overrides['m-main']).toBeUndefined();

    const bar = page.getByTestId('model-scope-bar');
    await bar.click();
    await page.getByRole('option', { name: '主力模型', exact: true }).click();
    await page.locator('aside').getByRole('button', { name: '模型配置', exact: true }).click();
    await page.getByTestId('model-settings').first().click();
    const modelStrategy = fieldOf(page, '上下文策略');
    await modelStrategy.getByRole('combobox', { name: '上下文策略' }).click();
    await page.getByRole('option', { name: '汇总', exact: true }).click();
    saved = await settingsJson(page);
    state = JSON.parse(saved) as { state: { global: { contextStrategy: string }; overrides: Record<string, { contextStrategy?: string }> } };
    expect(state.state.global.contextStrategy).toBe('window');
    expect(state.state.overrides['m-main'].contextStrategy).toBe('compact');
  });

  test('system prompt edits persist', async ({ page }) => {
    const prompt = fieldOf(page, '系统提示词');
    const ta = prompt.locator('textarea');
    await ta.fill('你是 Vrykell 助手。');
    await expect(page.locator('.settings-page-header').getByRole('status')).toHaveText('已保存');
    const saved = await settingsJson(page);
    expect(saved).toContain('你是 Vrykell 助手。');
  });

  test('per-model override: selecting a model in the model scope bar overrides the global value and can be reset', async ({ page }) => {
    // Model scope bar: default configuration is selected; open the menu and pick the "primary model"
    const bar = page.getByTestId('model-scope-bar');
    await expect(bar).toContainText('默认配置');
    await bar.click();
    await page.getByRole('option', { name: '主力模型', exact: true }).click();
    await expect(page.getByText('使用默认配置', { exact: true })).toBeVisible();
    // Turn off Agent mode for this model
    const agentSwitch = fieldOf(page, 'Agent 模式').getByRole('switch');
    await agentSwitch.click();
    await expect(page.getByText(/已覆盖 1 项/)).toBeVisible();
    const saved = await settingsJson(page);
    expect(saved).toContain('"overrides"');
    // Reset
    await page.getByRole('button', { name: '重置为默认配置' }).click();
    await expect(page.getByText('使用默认配置', { exact: true })).toBeVisible();
    const after = await settingsJson(page);
    expect(after).not.toContain('"m-main"');
  });

  test('automatic conversation title toggle turns off', async ({ page }) => {
    await fieldOf(page, '智能会话标题').getByRole('switch').click();
    const saved = await settingsJson(page);
    expect(saved).toContain('"autoTitle":false');
  });
});
