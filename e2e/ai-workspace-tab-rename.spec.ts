import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test('AI workspace renames directly on the instance tab without a second title bar', async ({ page }) => {
  await setupTauriMock(page, { schedulesSeed: [] });
  await page.goto('/');
  await page.getByTestId('workspace-area-ai').click();
  await page.getByTestId('ai-new-conversation').click();
  const strip = page.getByTestId('workspace-instance-bar');
  const tab = strip.getByRole('tab', { name: '新对话', exact: true });
  await expect(tab).toBeVisible();
  await expect(page.getByTestId('ai-surface-main').locator('.chat-conversation-heading')).toHaveCount(0);
  await tab.dblclick();
  const input = strip.getByRole('textbox', { name: '标签页标题' });
  await expect(input).toBeVisible();
  await input.fill('Build investigation');
  await input.press('Enter');
  await expect(strip.getByRole('tab', { name: 'Build investigation', exact: true })).toBeVisible();
  await expect(page.getByTestId('ai-surface-main').locator('.chat-conversation-heading')).toHaveCount(0);
});
