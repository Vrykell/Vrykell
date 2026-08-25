/**
 * AI 聊天面板 e2e：面板对话 / 模型菜单 / 思考强度 / 深思与 Agent 开关 / 输入锁定。
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock, mockAnthropic, aiModelCalls } from './tauri-mock';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
});

test.describe('AI 对话面板', () => {
  test('打开面板发送消息，流式渲染回复', async ({ page }) => {
    await mockAnthropic(page, '面板回复内容');
    await page.locator('[data-dock-btn="chat"]').click();
    const input = page.getByPlaceholder(/自然语言描述/);
    await expect(input).toBeVisible({ timeout: 3000 });
    await input.fill('帮我看看');
    await input.press('Enter');
    await expect(page.getByText('面板回复内容')).toBeVisible({ timeout: 10000 });
  });

  test('面板打开时终端输入栏 AI 模式被锁定', async ({ page }) => {
    await page.locator('[data-dock-btn="chat"]').click();
    await expect(page.getByPlaceholder(/自然语言描述/)).toBeVisible();
    // 终端输入栏的 cmd pill 禁用：title 提示去面板提问
    const pill = page.getByRole('button', { name: 'cmd' });
    await expect(pill).toHaveAttribute('title', /AI 对话面板开启中/);
    await expect(pill).toBeDisabled();
  });

  test('模型菜单：切换模型调用 set_active_model，思考强度可选', async ({ page }) => {
    await page.locator('[data-dock-btn="chat"]').click();
    await expect(page.getByPlaceholder(/自然语言描述/)).toBeVisible();
    // 打开模型菜单
    await page.getByTitle('切换模型（更多在设置页配置）').click();
    await expect(page.getByText('主力模型')).toBeVisible();
    await expect(page.getByText('本地模型')).toBeVisible();
    await expect(page.getByText('思考强度')).toBeVisible();
    // 切到本地模型
    await page.getByText('本地模型', { exact: true }).click();
    const calls = await aiModelCalls(page);
    expect(calls.some((c) => c.kind === 'set_active' && c.id === 'm-local')).toBe(true);
  });

  test('深度思考 / Agent 模式开关：切换后写模型覆盖', async ({ page }) => {
    await page.locator('[data-dock-btn="chat"]').click();
    await expect(page.getByPlaceholder(/自然语言描述/)).toBeVisible();
    // 关闭 Agent 模式（默认开）
    await page.getByTitle('Agent 模式（可使用工具）').click();
    let saved = await page.evaluate(() => localStorage.getItem('vrykell-agent-settings') ?? '');
    expect(saved).toContain('"agentMode":false');
    // 开深度思考 → 出现思考强度菜单项
    await page.getByTitle('深度思考（reasoning effort）').click();
    saved = await page.evaluate(() => localStorage.getItem('vrykell-agent-settings') ?? '');
    expect(saved).toContain('"deepThink":true');
  });
});
