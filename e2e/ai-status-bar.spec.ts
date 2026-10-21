import { test, expect } from '@playwright/test';
import { setupTauriMock, mockAnthropic, ensureChatSettingsOpen } from './tauri-mock';

test('AI controls belong to the conversation while terminal input stays in command mode', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await page.getByRole('button', { name: '询问 AI', exact: true }).click();
  await ensureChatSettingsOpen(page);
  await expect(page.locator('.ai-chat-panel').getByTestId('model-pill')).toBeVisible();
  await expect(page.getByRole('button', { name: '对话与审批模式' })).toBeVisible();
  await expect(page.getByTestId('ai-status-bar')).toHaveCount(0);
  await expect(page.locator('[data-terminal-input]')).toBeVisible();
  await page.locator('[data-dock-btn="chat"]').click();
  await expect(page.locator('[data-chat-composer]')).not.toBeVisible();
  await expect(page.locator('[data-terminal-input]')).toBeVisible();
});

test('pasted image attachments can be sent without a text question', async ({ page }) => {
  await mockAnthropic(page, 'I can see the image.');
  await setupTauriMock(page);
  await page.goto('/');
  await page.getByRole('button', { name: '询问 AI', exact: true }).click();
  await page.locator('[data-chat-composer]').evaluate(element => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['image'], 'screenshot.png', { type: 'image/png' }));
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: transfer });
    element.dispatchEvent(event);
  });
  await expect(page.getByText('screenshot.png', { exact: true })).toBeVisible();
  const send = page.getByRole('button', { name: '发送', exact: true });
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.getByText('I can see the image.', { exact: true })).toBeVisible();
});

test('the conversation model picker stays available after leaving settings', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await page.locator('[data-dock-btn="chat"]').click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.locator('.settings-screen')).toBeVisible();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await ensureChatSettingsOpen(page);
  await page.locator('.ai-chat-panel [data-tip="切换模型"]').click();
  await expect(page.getByRole('dialog', { name: '选择模型' })).toBeVisible();
  await page.getByPlaceholder('搜索模型…').fill('本地');
  await expect(page.getByTestId('model-pick-m-local')).toBeVisible();
});
