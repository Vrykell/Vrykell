import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test('bounds resource titles while preserving full names and selection', async ({ page }, info) => {
  await setupTauriMock(page); await page.goto('/');
  await expect(page.locator('[data-terminal-input]:visible')).toBeVisible();
  await page.getByTestId('workspace-area-ai').click();
  await page.getByTestId('ai-new-conversation').click();
  await expect(page.locator('[data-chat-composer]:visible')).toBeVisible();
  await page.getByTestId('workspace-instance-bar').getByTestId('workspace-resource-switcher').click();
  expect((await page.getByRole('menu', { name: '全部工作区标签' }).boundingBox())!.width).toBeLessThan(320);
  await page.keyboard.press('Escape');
  const title = 'Review saved facts and pending memories '.repeat(3).slice(0, 80).trim();
  await page.evaluate(async title => {
    const chatPath = '/src/features/chat/stores/chat.ts';
    const { useChatStore } = await import(chatPath) as typeof import('../src/features/chat/stores/chat');
    const id = useChatStore.getState().activeConversationId;
    useChatStore.getState().renameConversation(id, title);
  }, title);
  for (const width of [1240, 500]) {
    await page.setViewportSize({ width, height: 800 });
    await page.getByTestId('workspace-instance-bar').getByTestId('workspace-resource-switcher').click();
    const menu = page.getByRole('menu', { name: '全部工作区标签' });
    const item = menu.getByRole('menuitem', { name: title, exact: true });
    await expect(item).toHaveAttribute('data-tip', title);
    expect((await menu.boundingBox())!.width).toBeLessThanOrEqual(320);
    const label = item.locator('[data-menu-label]');
    await expect(label).toHaveCSS('white-space', 'nowrap');
    await expect(label).toHaveCSS('text-overflow', 'ellipsis');
    expect(await label.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`resource-menu-${width}.png`) });
    if (width === 500) {
      await item.click();
      await expect(page.getByTestId('workspace-area-ai')).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('[data-chat-composer]:visible')).toBeVisible();
    } else await page.keyboard.press('Escape');
  }
});
