/**
 * 设置页 e2e：模型行为（Agent/深度思考/思考强度/上下文策略/智能标题 + 每模型覆盖）。
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

test.describe('模型行为页', () => {
  test('Agent 模式 / 深度思考开关：切换后持久化，思考强度出现', async ({ page }) => {
    const switches = page.getByRole('switch');
    // 顺序：Agent 模式、深度思考、采样温度、智能会话标题、命令自动补全
    const agentSwitch = switches.nth(0);
    const thinkSwitch = switches.nth(1);
    await expect(agentSwitch).toHaveAttribute('aria-checked', 'true');

    await agentSwitch.click();
    await expect(agentSwitch).toHaveAttribute('aria-checked', 'false');
    let saved = await settingsJson(page);
    expect(saved).toContain('"agentMode":false');

    // 深度思考开启 → 思考强度字段出现
    await thinkSwitch.click();
    await expect(thinkSwitch).toHaveAttribute('aria-checked', 'true');
    saved = await settingsJson(page);
    expect(saved).toContain('"deepThink":true');
    await expect(page.getByText('思考强度')).toBeVisible();
  });

  test('思考强度切换为低并持久化', async ({ page }) => {
    await page.getByRole('switch').nth(1).click(); // 开深度思考
    const strength = fieldOf(page, '思考强度');
    await strength.getByRole('button', { name: '低' }).click();
    const saved = await settingsJson(page);
    expect(saved).toContain('"thinkingLevel":"low"');
  });

  test('上下文策略切到窗口', async ({ page }) => {
    const strategy = fieldOf(page, '上下文策略');
    await strategy.getByRole('button', { name: '窗口' }).click();
    const saved = await settingsJson(page);
    expect(saved).toContain('"contextStrategy":"window"');
  });

  test('系统提示词编辑持久化', async ({ page }) => {
    const prompt = fieldOf(page, '系统提示词');
    const ta = prompt.locator('textarea');
    await ta.fill('你是 Vrykell 助手。');
    const saved = await settingsJson(page);
    expect(saved).toContain('你是 Vrykell 助手。');
  });

  test('每模型覆盖：模型选择条选中模型后覆盖全局，可重置', async ({ page }) => {
    // 模型选择条：默认全局默认，点开菜单选「主力模型」
    const bar = page.getByTestId('model-scope-bar');
    await expect(bar).toContainText('全局默认');
    await bar.click();
    await page.getByRole('button', { name: '主力模型', exact: true }).click();
    await expect(page.getByText('跟随全局默认')).toBeVisible();
    // 关闭该模型的 Agent 模式
    const switches = page.getByRole('switch');
    await switches.nth(0).click();
    await expect(page.getByText(/已覆盖 1 项/)).toBeVisible();
    const saved = await settingsJson(page);
    expect(saved).toContain('"overrides"');
    // 重置
    await page.getByRole('button', { name: '重置为全局默认' }).click();
    await expect(page.getByText('跟随全局默认')).toBeVisible();
    const after = await settingsJson(page);
    expect(after).not.toContain('"m-main"');
  });

  test('智能会话标题开关关闭', async ({ page }) => {
    // 全局作用域下最后一个 switch 组：智能会话标题（nth 3）、命令自动补全（nth 4）
    await page.getByRole('switch').nth(3).click();
    const saved = await settingsJson(page);
    expect(saved).toContain('"autoTitle":false');
  });
});
