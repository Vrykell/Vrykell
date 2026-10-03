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
    localStorage.setItem('dock-layout-v4', JSON.stringify({
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
    const pill = page.getByRole('button', { name: '命令', exact: true });
    await expect(pill).toHaveAttribute('title', /AI 对话面板开启中/);
    await pill.click();
    await expect(page.getByPlaceholder(/自然语言描述/)).toHaveCount(1); // 终端未进入 AI 模式
  });

  test('模型选择窗口：搜索过滤 + 能力标签过滤 + 点击选中', async ({ page }) => {
    await boot(page, '好的');
    await page.locator('[data-dock-btn="chat"]').click();
    await expect(page.getByPlaceholder(/自然语言描述/)).toBeVisible();
    // 打开模型选择窗口
    await page.getByTitle('切换模型（更多在设置页配置）').click();
    await expect(page.getByText('选择模型', { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder('搜索模型…')).toBeVisible();
    // 两个模型列表项（带能力徽标）
    await expect(page.getByTestId('model-pick-m-main')).toBeVisible();
    await expect(page.getByTestId('model-pick-m-local')).toBeVisible();
    await expect(page.getByText('推理', { exact: true }).first()).toBeVisible();

    // 能力标签过滤：点「推理」→ 只剩主力模型
    await page.getByRole('button', { name: /推理/ }).click();
    await expect(page.getByTestId('model-pick-m-main')).toBeVisible();
    await expect(page.getByTestId('model-pick-m-local')).toHaveCount(0);
    await page.getByRole('button', { name: /推理/ }).click(); // 取消

    // 搜索过滤：按名字
    await page.getByPlaceholder('搜索模型…').fill('本地');
    await expect(page.getByTestId('model-pick-m-local')).toBeVisible();
    await expect(page.getByTestId('model-pick-m-main')).toHaveCount(0);
    await page.getByPlaceholder('搜索模型…').fill('不存在的模型');
    await expect(page.getByText('无匹配模型')).toBeVisible();

    // 点击列表项选中模型
    await page.getByPlaceholder('搜索模型…').fill('');
    await page.getByTestId('model-pick-m-main').click();
    const calls = await aiModelCalls(page);
    expect(calls.some((c) => c.kind === 'set_active' && c.id === 'm-main')).toBe(true);
    await expect(page.getByText('已切换到 主力模型')).toBeVisible();
    // 选中后窗口关闭
    await expect(page.getByText('选择模型', { exact: true })).toHaveCount(0);
  });

  test('模型选择窗口：列表项内快速调整思考强度', async ({ page }) => {
    await boot(page, '好的');
    await page.locator('[data-dock-btn="chat"]').click();
    await expect(page.getByPlaceholder(/自然语言描述/)).toBeVisible();
    await page.getByTitle('切换模型（更多在设置页配置）').click();
    const row = page.getByTestId('model-pick-m-main');
    await expect(row).toBeVisible();
    // 主力模型（推理能力）有思考强度下拉；切到「低」写模型覆盖
    const select = row.getByTestId('think-level-m-main');
    await select.selectOption('low');
    const saved = await page.evaluate(() => localStorage.getItem('vrykell-agent-settings') ?? '');
    expect(saved).toContain('"thinkingLevel":"low"');
    // 无推理能力的模型不显示思考强度控件
    await expect(page.getByTestId('model-pick-m-local').locator('select')).toHaveCount(0);
    // 关闭窗口
    await page.keyboard.press('Escape');
    await expect(page.getByText('选择模型', { exact: true })).toHaveCount(0);
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
