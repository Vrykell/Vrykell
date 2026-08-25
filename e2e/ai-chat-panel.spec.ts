/**
 * AI 聊天面板 e2e：面板对话 / 模型菜单 / 思考强度 / 深思与 Agent 开关 / 输入锁定。
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock, mockAnthropic, aiModelCalls } from './tauri-mock';

/** 每个测试独立初始化：mockAnthropic 的 init script 必须在 goto 前注册 */
async function boot(page: import('@playwright/test').Page, reply: string) {
  await mockAnthropic(page, reply);
  await setupTauriMock(page);
  // 种入 dock 布局：chat 面板按钮在左区（默认布局里 chat 不在任何 zone）
  await page.addInitScript(() => {
    localStorage.setItem('dock-layout-v3', JSON.stringify({
      leftZone: ['tabs', 'chat'], rightZone: ['files'],
      leftPanels: [], rightPanels: [], panelWidths: {},
    }));
  });
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
}

test.describe('AI 对话面板', () => {
  test('打开面板发送消息，流式渲染回复', async ({ page }) => {
    await boot(page, '面板回复内容');
    await page.locator('[data-dock-btn="chat"]').click();
    const input = page.getByPlaceholder(/自然语言描述/);
    await expect(input).toBeVisible({ timeout: 3000 });
    await input.fill('帮我看看');
    await input.press('Enter');
    await expect(page.getByText('面板回复内容')).toBeVisible({ timeout: 10000 });
  });

  test('面板打开时终端输入栏 AI 模式被锁定', async ({ page }) => {
    await boot(page, '好的');
    await page.locator('[data-dock-btn="chat"]').click();
    await expect(page.getByPlaceholder(/自然语言描述/)).toBeVisible();
    // 终端输入栏的 cmd pill 提示去面板提问（点击被守卫拦截）
    const pill = page.getByRole('button', { name: 'cmd' });
    await expect(pill).toHaveAttribute('title', /AI 对话面板开启中/);
    await pill.click();
    await expect(page.getByPlaceholder(/自然语言描述/)).toHaveCount(1); // 终端未进入 AI 模式
  });

  test('模型菜单：切换模型调用 set_active_model，思考强度可选', async ({ page }) => {
    await boot(page, '好的');
    await page.locator('[data-dock-btn="chat"]').click();
    await expect(page.getByPlaceholder(/自然语言描述/)).toBeVisible();
    // 打开模型菜单：当前生效的是本地模型（默认种子），菜单里带 ✓
    await page.getByTitle('切换模型（更多在设置页配置）').click();
    await expect(page.getByText('✓ 本地模型')).toBeVisible();
    await expect(page.getByText('思考强度')).toBeVisible();
    // 切到主力模型
    await page.getByRole('button', { name: '主力模型', exact: true }).click();
    const calls = await aiModelCalls(page);
    expect(calls.some((c) => c.kind === 'set_active' && c.id === 'm-main')).toBe(true);
  });

  test('深度思考 / Agent 模式开关：切换后写模型覆盖', async ({ page }) => {
    await boot(page, '好的');
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
