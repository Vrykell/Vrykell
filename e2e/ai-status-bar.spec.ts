/**
 * 终端 AI 模式 e2e：pane 顶部 AI 状态栏（模型/深思/Agent）+ 图片附件粘贴。
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock, mockAnthropic } from './tauri-mock';

/** 每个测试独立初始化：mockAnthropic 的 init script 必须在 goto 前注册 */
async function boot(page: import('@playwright/test').Page, reply?: string) {
  if (reply) await mockAnthropic(page, reply);
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
}

test.describe('终端 AI 模式', () => {
  test('切换到 AI 模式出现状态栏（模型按钮 + 深思/Agent 开关）', async ({ page }) => {
    await boot(page);
    await page.getByRole('button', { name: 'cmd' }).click();
    const bar = page.getByTestId('ai-status-bar');
    await expect(bar).toBeVisible();
    await expect(bar.getByTitle('切换模型（更多在设置页配置）')).toBeVisible();
    await expect(bar.getByTitle('深度思考')).toBeVisible();
    await expect(bar.getByTitle('Agent 模式（可使用工具）')).toBeVisible();
    // 切回命令模式状态栏消失
    await page.getByRole('button', { name: 'AI' }).click();
    await expect(bar).toHaveCount(0);
  });

  test('状态栏深思开关：切换写模型覆盖', async ({ page }) => {
    await boot(page);
    await page.getByRole('button', { name: 'cmd' }).click();
    const bar = page.getByTestId('ai-status-bar');
    await bar.getByTitle('深度思考').click();
    const saved = await page.evaluate(() => localStorage.getItem('vrykell-agent-settings') ?? '');
    expect(saved).toContain('"deepThink":true');
  });

  test('状态栏模型菜单：切换模型与思考强度', async ({ page }) => {
    await boot(page);
    await page.getByRole('button', { name: 'cmd' }).click();
    const bar = page.getByTestId('ai-status-bar');
    await bar.getByTitle('切换模型（更多在设置页配置）').click();
    await expect(page.getByText('思考强度')).toBeVisible();
    await page.getByText('低', { exact: true }).click();
    const saved = await page.evaluate(() => localStorage.getItem('vrykell-agent-settings') ?? '');
    expect(saved).toContain('"thinkingLevel":"low"');
  });

  test('AI 模式粘贴图片：附件 chip 出现，空文本 + 附件可发送', async ({ page }) => {
    await boot(page, '看到了图片');
    await page.getByRole('button', { name: 'cmd' }).click();
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
});
