import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test.use({ deviceScaleFactor: 1.25 });

for (const theme of ['dark', 'light']) test(`compact creation, opacity and long conversation errors in ${theme}`, async ({ page }, info) => {
  await setupTauriMock(page, { schedulesSeed: [] });
  await page.addInitScript(theme => localStorage.setItem('vrykell-theme-mode', theme), theme);
  await page.goto('/');
  await page.evaluate(() => { document.documentElement.dataset.nativeMaterial = 'fallback'; });
  const trigger = page.getByTestId('tab-new-btn');
  await trigger.click();
  const picker = page.getByRole('dialog', { name: '新建标签页' });
  await expect(picker).toHaveAttribute('aria-modal', 'false');
  const bounds = (await picker.boundingBox())!;
  expect(bounds.width).toBeLessThanOrEqual(304);
  expect(bounds.height).toBeLessThanOrEqual(480);
  expect(bounds.y).toBeLessThan(100);
  await expect(page.locator('.new-tab-overlay')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await picker.screenshot({ path: info.outputPath(`compact-dropdown-${theme}.png`) });
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Control+,');
  await expect(page.getByRole('button', { name: '终端默认行为', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '主题', exact: true }).click();
  const slider = page.getByRole('slider', { name: '应用不透明度' });
  await expect(slider).toHaveClass(/range-input/);
  await expect(slider).toHaveCSS('height', '20px');
  await page.screenshot({ path: info.outputPath(`appearance-${theme}.png`) });
  await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    const chatPath = '/src/features/chat/stores/chat.ts';
    const aiPath = '/src/features/chat/stores/aiWorkspace.ts';
    const workspacePath = '/src/features/workspace/stores/workspace.ts';
    const { useChatStore } = await import(chatPath) as typeof import('../src/features/chat/stores/chat');
    const { useAiWorkspace } = await import(aiPath) as typeof import('../src/features/chat/stores/aiWorkspace');
    const { useWorkspaceStore } = await import(workspacePath) as typeof import('../src/features/workspace/stores/workspace');
    const id = useChatStore.getState().createConversation();
    useAiWorkspace.getState().openNative(id);
    useWorkspaceStore.getState().openHarnessTab();
  });
  const chat = page.locator('.ai-native-surface .ai-chat-panel');
  await expect(chat).toBeVisible();
  await expect(chat.locator('.chat-empty')).toHaveCount(0);
  await page.evaluate(async () => {
    const path = '/src/features/chat/stores/chat.ts';
    const { useChatStore } = await import(path) as typeof import('../src/features/chat/stores/chat');
    const id = useChatStore.getState().activeConversationId;
    useChatStore.setState(state => ({ byTab: { ...state.byTab, [id]: [
      { id: 'review-question', role: 'user', content: 'Explain this failure', createdAt: Date.now() },
      { id: 'review-answer', role: 'assistant', content: '', createdAt: Date.now(), error: true, errorText: `Service refused request. ${'LongDiagnosticWithoutSpaces'.repeat(100)}` },
    ] } }));
  });
  const error = page.locator('#app-notifications').getByRole('alert');
  await expect(error.getByRole('button', { name: '重试', exact: true })).toBeVisible();
  const details = error.getByRole('button', { name: '技术详情', exact: true });
  await details.click();
  for (const width of [1240, 640]) {
    await page.setViewportSize({ width, height: 800 });
    const retry = (await error.getByRole('button', { name: '重试', exact: true }).boundingBox())!;
    const box = (await error.boundingBox())!;
    expect(retry.width).toBeGreaterThan(30);
    expect(retry.x).toBeGreaterThan(box.x + box.width / 2);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`conversation-error-${theme}-${width}.png`) });
  }
});
