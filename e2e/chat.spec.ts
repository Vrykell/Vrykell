import { test, expect } from '@playwright/test';
import { setupTauriMock, mockAnthropic } from './tauri-mock';

test.describe('chat 对话链路（内联 AI 模式）', () => {
  test('AI 模式发送消息后流式渲染 AI 回复', async ({ page }) => {
    await mockAnthropic(page, '好的，这是**加粗内容**测试。');
    await setupTauriMock(page);
    await page.goto('/');
    // 等待终端就绪（blockList 场景下 xterm 隐藏，输入栏可见）
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });

    // 点击 ⚡ 切换到 AI 模式
    await page.getByTitle(/切换到 AI 模式/).click();

    // 输入自然语言并发送
    const input = page.getByPlaceholder(/自然语言描述/);
    await expect(input).toBeVisible();
    await input.fill('你好');
    await input.press('Enter');

    // 等待 AI 回复出现在内联 AI 区
    await expect(page.getByText('加粗内容')).toBeVisible({ timeout: 10000 });
  });

  test('AI 回复包含文本内容', async ({ page }) => {
    await mockAnthropic(page, '欧拉公式：e^{i*pi} + 1 = 0 是数学中最美的公式之一。');
    await setupTauriMock(page);
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });

    await page.getByTitle(/切换到 AI 模式/).click();
    const input = page.getByPlaceholder(/自然语言描述/);
    await input.fill('写个公式');
    await input.press('Enter');

    // 内联 AI 区显示回复文本
    await expect(page.getByText(/欧拉公式/)).toBeVisible({ timeout: 10000 });
  });

  test('首条消息自动命名标签', async ({ page }) => {
    await mockAnthropic(page, '好的');
    await setupTauriMock(page);
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });

    await page.getByTitle(/切换到 AI 模式/).click();
    const input = page.getByPlaceholder(/自然语言描述/);
    await input.fill('麦克斯韦方程组');
    await input.press('Enter');

    await expect(page.getByText('麦克斯韦方程组').first()).toBeVisible({ timeout: 10000 });
  });

  test('发送中输入禁用，完成后恢复', async ({ page }) => {
    await mockAnthropic(page, '完成');
    await setupTauriMock(page);
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });

    await page.getByTitle(/切换到 AI 模式/).click();
    const input = page.getByPlaceholder(/自然语言描述/);
    await input.fill('测试');
    await input.press('Enter');

    await expect(page.getByText('完成')).toBeVisible({ timeout: 10000 });
    await expect(input).toBeEnabled();
  });
});
