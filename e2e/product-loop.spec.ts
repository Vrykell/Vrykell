import { test, expect } from '@playwright/test';
import { setupTauriMock, mockAnthropic, ensureTabsOpen } from './tauri-mock';

test('AI 草稿和附件按会话保留，关闭面板后仍能继续发送', async ({ page }) => {
  await setupTauriMock(page);
  await mockAnthropic(page, '任务完成');
  await page.goto('/');
  await ensureTabsOpen(page);
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
  const input = page.getByPlaceholder('自然语言描述你想做什么…');
  await input.fill('终端一的草稿');
  await input.evaluate((element) => {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { files: [], getData: () => '上下文'.repeat(300) } });
    element.dispatchEvent(event);
  });
  await expect(page.locator('[data-tip="移除附件"]')).toHaveCount(1);
  await page.getByRole('button', { name: '新建终端', exact: true }).click();
  await page.getByRole('button', { name: /Zsh.*默认终端/ }).click();
  await expect(input).toHaveValue('终端一的草稿');
  await expect(page.locator('[data-tip="移除附件"]')).toHaveCount(1);
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await expect(input).toHaveValue('');
  await input.fill('第二个对话的草稿');
  await page.getByRole('button', { name: 'AI 对话历史', exact: true }).click();
  await page.locator('.ai-history-list [data-testid^="conversation-row-"]').last().click();
  await page.getByTestId('tab-row-t1').click();
  await expect(input).toHaveValue('终端一的草稿');
  await expect(page.locator('[data-tip="移除附件"]')).toHaveCount(1);
  await page.getByRole('button', { name: '关闭AI 助手面板', exact: true }).click();
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
  await expect(input).toHaveValue('终端一的草稿');
  await expect(page.locator('[data-tip="移除附件"]')).toHaveCount(1);
  await input.press('Enter');
  await expect(page.getByText('任务完成', { exact: true })).toBeVisible();
  await expect(input).toHaveValue('');
  await expect(page.locator('[data-tip="移除附件"]')).toHaveCount(0);
  await page.locator('.ai-block').locator('.chat-answer-actions').getByRole('button', { name: '编辑重发', exact: true }).click();
  await page.getByRole('dialog', { name: '编辑重发' }).getByRole('button', { name: '编辑重发', exact: true }).click();
  await expect(input).toHaveValue('终端一的草稿');
  await expect(page.locator('[data-tip="移除附件"]')).toHaveCount(1);
  await input.fill('带着原附件继续');
  await input.press('Enter');
  await expect(page.getByText('任务完成', { exact: true })).toBeVisible();
});

test('failed directory navigation retains the view and can be retried', async ({ page }) => {
  await setupTauriMock(page);
  await page.addInitScript(() => {
    const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const original = internals.invoke;
    let attempts = 0;
    internals.invoke = async (command, args) => {
      if (command !== 'fs_list') return original(command, args);
      if (args?.path === '/home/e2e/project/Denied') {
        if (attempts++ < 1) throw new Error('denied');
        return [{ name: '恢复后的文件.txt', path: '/home/e2e/project/Denied/恢复后的文件.txt', is_dir: false }];
      }
      return [{ name: 'Denied', path: '/home/e2e/project/Denied', is_dir: true }];
    };
  });
  await page.goto('/');
  await page.locator('[data-dock-btn="files"]').click();
  await page.getByText('Denied', { exact: true }).dblclick();
  // Failed navigation leaves the current view intact and reports the action through a toast.
  await expect(page.getByRole('status').filter({ hasText: 'denied' })).toBeVisible();
  await expect(page.getByText('Denied', { exact: true })).toBeVisible();
  await expect(page.getByText('空目录', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: '.cache-usability.local/product-loop-proof.png' });
  await page.getByText('Denied', { exact: true }).dblclick();
  await expect(page.getByText('恢复后的文件.txt')).toBeVisible();
  await page.getByRole('button', { name: '回到上一个视图', exact: true }).click();
  await expect(page.getByText('Denied', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
