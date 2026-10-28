import { expect, test } from '@playwright/test';
import { mockAnthropic, setupTauriMock } from './tauri-mock';

test('keeps sent image and paste cards under the question and dismisses previews in pure chat', async ({ page }, info) => {
  test.setTimeout(60_000);
  await mockAnthropic(page, 'Image and pasted text received.');
  await setupTauriMock(page, { aiActive: 'm-vision', aiModels: [{ id: 'm-vision', name: 'Vision model', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1', model: 'vision-test', capabilities: { vision: true, reasoning: false, tools: true, search: false } }] });
  await page.goto('/');
  await page.getByTestId('workspace-area-ai').click();
  await page.getByTestId('ai-new-conversation').click();
  await page.evaluate(async () => {
    const settingsPath = '/src/features/agent/stores/agentSettings.ts';
    const { useAgentSettings } = await import(settingsPath) as typeof import('../src/features/agent/stores/agentSettings');
    useAgentSettings.getState().update({ agentMode: false });
    const host = window as unknown as { __IMAGE_REQUEST__?: boolean; __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } };
    const original = host.__TAURI_INTERNALS__.invoke;
    host.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command === 'llm_stream') {
        const request = JSON.parse((args?.req as { body: string }).body) as { messages?: { role: string; content: { type: string }[] | string }[]; tools?: unknown[] };
        host.__IMAGE_REQUEST__ = !request.tools?.length && !!request.messages?.some(message => message.role === 'user' && Array.isArray(message.content) && message.content.some(part => part.type === 'image_url'));
      }
      return original(command, args);
    };
  });
  const composer = page.locator('[data-chat-composer]:visible');
  await composer.fill('Explain the attached context');
  await composer.evaluate(element => {
    const image = new DataTransfer();
    image.items.add(new File(['image'], 'sample.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: image, bubbles: true, cancelable: true }));
    const text = new DataTransfer(); text.setData('text/plain', 'Context line\n'.repeat(80));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: text, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('.chat-context-tray .chat-attachment-chip')).toHaveCount(2);
  await composer.press('Enter');
  await expect(page.getByText('Image and pasted text received.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __IMAGE_REQUEST__: boolean }).__IMAGE_REQUEST__)).toBe(true);
  const exchange = page.locator('.chat-exchange').last();
  expect(await exchange.evaluate(element => {
    const question = element.querySelector('.ai-block-question')!;
    const cards = element.querySelector('.chat-question-attachments')!;
    const answer = element.querySelector('.ai-block-answer')!;
    return question.nextElementSibling === cards && !!(cards.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
  for (const chip of await exchange.locator('.chat-attachment-name').all()) {
    await chip.click();
    const preview = page.getByRole('dialog');
    await expect(preview).toBeVisible();
    await preview.click(); await expect(preview).toBeVisible();
    await composer.click(); await expect(preview).toHaveCount(0);
    await chip.click(); await page.keyboard.press('Escape');
    await expect(preview).toHaveCount(0); await expect(chip).toBeFocused();
  }
  for (const width of [1240, 760]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(exchange.locator('.chat-question-attachments')).toBeVisible();
    await page.screenshot({ path: info.outputPath(`question-attachments-${width}.png`), animations: 'disabled' });
  }
});
