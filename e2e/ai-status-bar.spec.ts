/**
 * 终端 AI 模式 e2e：pane 顶部 AI 状态栏（模型/深思/Agent）+ 图片附件粘贴。
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock, mockAnthropic } from './tauri-mock';

/** 每个测试独立初始化：mockAnthropic 的 init script 必须在 goto 前注册 */
async function boot(
  page: import('@playwright/test').Page,
  reply?: string,
  opts?: Parameters<typeof setupTauriMock>[1],
) {
  if (reply) await mockAnthropic(page, reply);
  await setupTauriMock(page, opts);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
}

test.describe('终端 AI 模式', () => {
  test('切换到 AI 模式出现状态栏（模型按钮 + 深思/Agent 开关）', async ({ page }) => {
    await boot(page);
    await page.getByRole('button', { name: '命令', exact: true }).click();
    const bar = page.getByTestId('ai-status-bar');
    await expect(bar).toBeVisible();
    // 胶囊入口：图标 + 名称(7) ｜ 思考强度 + 下拉提示(3)，悬停前透明无边框
    const pill = bar.getByTestId('model-pill');
    await expect(pill).toBeVisible();
    const nameBtn = pill.getByTestId('pill-name');
    await expect(nameBtn).toContainText('本地模型');
    await expect(pill.getByTestId('pill-level')).toContainText('高');
    await expect(pill.locator('svg')).toHaveCount(2); // 模型图标 + 下拉提示（图标库实现）
    await expect(pill).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(bar.getByTitle('深度思考')).toBeVisible();
    await expect(bar.getByTitle('Agent 模式（可使用工具）')).toBeVisible();
    // 切回命令模式状态栏消失
    await page.getByRole('button', { name: 'AI', exact: true }).click();
    await expect(bar).toHaveCount(0);
  });

  test('胶囊内快速调整思考强度：原位下拉与胶囊同宽对齐，选完恢复', async ({ page }) => {
    await boot(page);
    await page.getByRole('button', { name: '命令', exact: true }).click();
    const bar = page.getByTestId('ai-status-bar');
    const pill = bar.getByTestId('model-pill');
    await expect(pill).toBeVisible();

    // 点强度区 → 原位下拉出现，胶囊名称区消失
    await pill.getByTestId('pill-level').click();
    const menu = page.getByTestId('think-level-menu');
    await expect(menu).toBeVisible();
    await expect(pill.getByTestId('pill-name')).toHaveCount(0);
    // 宽度与胶囊一致、顶端对齐（正好覆盖胶囊位置）
    const menuBox = await menu.boundingBox();
    const pillBox = await pill.boundingBox();
    expect(menuBox).not.toBeNull();
    expect(pillBox).not.toBeNull();
    expect(Math.abs(menuBox!.width - pillBox!.width)).toBeLessThan(1);
    expect(Math.abs(menuBox!.y - pillBox!.y)).toBeLessThan(1);
    // 高度自然展开（不被胶囊 30px 高度裁切）
    expect(menuBox!.height).toBeGreaterThan(30);

    // 选「低」→ 关闭恢复胶囊，强度写入模型覆盖
    await menu.getByRole('button', { name: '低', exact: true }).click();
    await expect(menu).toHaveCount(0);
    await expect(pill.getByTestId('pill-name')).toBeVisible();
    await expect(pill.getByTestId('pill-level')).toContainText('低');
    const saved = await page.evaluate(() => localStorage.getItem('vrykell-agent-settings') ?? '');
    expect(saved).toContain('"thinkingLevel":"low"');
  });

  test('状态栏深思开关：切换写模型覆盖', async ({ page }) => {
    await boot(page);
    await page.getByRole('button', { name: '命令', exact: true }).click();
    const bar = page.getByTestId('ai-status-bar');
    await bar.getByTitle('深度思考').click();
    const saved = await page.evaluate(() => localStorage.getItem('vrykell-agent-settings') ?? '');
    expect(saved).toContain('"deepThink":true');
  });

  test('状态栏打开模型选择窗口：本地模型项调思考强度', async ({ page }) => {
    await boot(page);
    await page.getByRole('button', { name: '命令', exact: true }).click();
    const bar = page.getByTestId('ai-status-bar');
    await bar.getByTitle('切换模型（更多在设置页配置）').click();
    // 窗口出现：搜索框 + 能力标签 + 列表项
    await expect(page.getByText('选择模型', { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder('搜索模型…')).toBeVisible();
    const row = page.getByTestId('model-pick-m-local');
    await expect(row).toBeVisible();
    // 本地模型无推理能力 → 无思考强度下拉；主力模型有
    await expect(row.locator('select')).toHaveCount(0);
    const main = page.getByTestId('model-pick-m-main');
    await main.locator('select').selectOption('low');
    const saved = await page.evaluate(() => localStorage.getItem('vrykell-agent-settings') ?? '');
    expect(saved).toContain('"thinkingLevel":"low"');
    await page.keyboard.press('Escape');
    await expect(page.getByText('选择模型', { exact: true })).toHaveCount(0);
  });

  test('AI 模式粘贴图片：附件 chip 出现，空文本 + 附件可发送', async ({ page }) => {
    await boot(page, '看到了图片');
    await page.getByRole('button', { name: '命令', exact: true }).click();
    const input = page.getByPlaceholder(/自然语言描述/);
    await expect(input).toBeVisible();

    // 模拟粘贴一个图片文件（Chrome 的 ClipboardEvent 构造不认 clipboardData，需 defineProperty）
    await page.evaluate(() => {
      const el = document.querySelector('textarea[placeholder*="自然语言描述"]') as HTMLTextAreaElement;
      const dt = new DataTransfer();
      dt.items.add(new File(['img'], 'screenshot.png', { type: 'image/png' }));
      const evt = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(evt, 'clipboardData', { value: dt });
      el.dispatchEvent(evt);
    });
    await expect(page.getByText('screenshot.png')).toBeVisible({ timeout: 3000 });
    // 附件 chip 显示 + 空文本也能发送（发送按钮可用）
    const sendBtn = page.getByTitle('发送 (Enter)');
    await expect(sendBtn).toBeEnabled();
    await sendBtn.click();
    await expect(page.getByText('看到了图片')).toBeVisible({ timeout: 10000 });
  });

  test('胶囊内中等长度模型名完整显示且宽度紧凑', async ({ page }) => {
    await boot(page, undefined, {
      aiActive: 'medium',
      aiModels: [
        { id: 'medium', name: '本地开发模型测试', provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'x-model', capabilities: { vision: false, reasoning: false, tools: true, search: false } },
      ],
    });
    await page.getByRole('button', { name: '命令', exact: true }).click();
    const pill = page.getByTestId('ai-status-bar').getByTestId('model-pill');
    // 名字完整显示（不做字符截断）
    await expect(pill.getByTestId('pill-name')).toContainText('本地开发模型测试');
    // 不超过布局上限
    const box = await pill.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(262);
  });

  test('胶囊内超长模型名完整显示，宽度按内容撑开', async ({ page }) => {
    await boot(page, undefined, {
      aiActive: 'long',
      aiModels: [
        { id: 'long', name: '超长模型名字测试一二三四五六七八九十', provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'x-model', capabilities: { vision: false, reasoning: false, tools: true, search: false } },
      ],
    });
    await page.getByRole('button', { name: '命令', exact: true }).click();
    const pill = page.getByTestId('ai-status-bar').getByTestId('model-pill');
    // 完整显示，不做任何省略
    await expect(pill.getByTestId('pill-name')).toContainText('超长模型名字测试一二三四五六七八九十');
    // 名称 span 未被截断：scrollWidth == clientWidth（无省略号）
    const noEllipsis = await pill
      .getByTestId('pill-name')
      .locator('span')
      .evaluate((el) => (el as HTMLElement).scrollWidth <= (el as HTMLElement).clientWidth + 1);
    expect(noEllipsis).toBe(true);
    // 胶囊宽度随内容撑开（超过默认紧凑宽度）
    const box = await pill.boundingBox();
    expect(box!.width).toBeGreaterThan(240);
  });

  test('胶囊内模型名超过 35 字符时截断显示', async ({ page }) => {
    const longName = '模'.repeat(40); // 40 字符，超过 35 上限
    await boot(page, undefined, {
      aiActive: 'vlong',
      aiModels: [
        { id: 'vlong', name: longName, provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'x-model', capabilities: { vision: false, reasoning: false, tools: true, search: false } },
      ],
    });
    await page.getByRole('button', { name: '命令', exact: true }).click();
    const pill = page.getByTestId('ai-status-bar').getByTestId('model-pill');
    // 显示前 35 字符 + 省略号
    await expect(pill.getByTestId('pill-name')).toContainText('模'.repeat(35) + '…');
  });
});
