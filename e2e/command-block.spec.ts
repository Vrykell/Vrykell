import { test, expect } from '@playwright/test';
import { setupTauriMock, mockAnthropic, ptyWrites, ensureChatSettingsOpen } from './tauri-mock';

test.describe('命令块链路', () => {
  test('bash 代码块显示运行按钮，点击后写入 PTY 并回显', async ({ page }) => {
    await mockAnthropic(page, '试试这个：\n\n```bash\necho hello-e2e\n```');
    await setupTauriMock(page);
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });

    // 切换到 AI 模式
    await page.getByRole('button', { name: '询问 AI', exact: true }).click();
    await ensureChatSettingsOpen(page);
    await page.getByRole('combobox', { name: '选择执行终端' }).click();
    await page.getByRole('listbox', { name: '选择执行终端' }).getByRole('option').filter({ hasNotText: '仅讨论' }).first().click();
    const input = page.getByPlaceholder(/自然语言描述/);
    await input.fill('给我个命令');
    await input.press('Enter');

    // 等待内联 AI 区出现运行按钮
    const runBtn = page.getByText('在终端运行');
    await expect(runBtn.first()).toBeVisible({ timeout: 10000 });
    await runBtn.first().click();

    await expect.poll(() => ptyWrites(page)).toContain('echo hello-e2e\n');
    // 新 block UI 中命令与输出均可见（无 $ 前缀）
    await expect(page.getByText('echo hello-e2e').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('hello-e2e').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('exit-code').first()).toHaveText('0', { timeout: 5000 });
  });

  test('python 代码块不显示运行按钮', async ({ page }) => {
    await mockAnthropic(page, '```python\nprint(1)\n```');
    await setupTauriMock(page);
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });

    await page.getByRole('button', { name: '询问 AI', exact: true }).click();
    const input = page.getByPlaceholder(/自然语言描述/);
    await input.fill('写代码');
    await input.press('Enter');

    await expect(page.locator('pre code')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('在终端运行')).toHaveCount(0);
  });
});
