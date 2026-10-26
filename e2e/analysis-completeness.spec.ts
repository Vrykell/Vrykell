import { expect, test } from '@playwright/test';
import { emitPtyOutput, setupTauriMock } from './tauri-mock';

test('command analysis retains the complete command and output through the model request', async ({ page }) => {
  await setupTauriMock(page, {}); await page.goto('/');
  await expect(page.locator('[data-terminal-input]')).toBeVisible();
  await page.waitForFunction(async () => {
    const path = '/src/features/terminal/stores/terminal.ts';
    const { useTerminalStore } = await import(path) as typeof import('../src/features/terminal/stores/terminal');
    return Object.values(useTerminalStore.getState().startupStates).includes('ready');
  });
  const command = `echo ${'argument '.repeat(400)}END_COMMAND`;
  const output = `${Array.from({ length: 140 }, (_, i) => `OUTPUT_ROW_${i}: full command result`).join('\r\n')}\r\nFINAL_OUTPUT_MARKER\r\n`;
  await emitPtyOutput(page, `\x1b]133;E;${btoa(command)}\x07\x1b]133;C\x07${output}\x1b]133;D;1\x07`);
  const block = page.locator('[data-testid^="command-block-"]').last();
  await expect(block.getByTestId('exit-code')).toBeVisible();
  await block.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '发给 AI 分析', exact: true }).click();
  const reference = await page.evaluate(async () => {
    const chatPath = '/src/features/chat/stores/chat.ts'; const draftPath = '/src/features/chat/stores/composerDrafts.ts';
    const { useChatStore } = await import(chatPath) as typeof import('../src/features/chat/stores/chat');
    const { useComposerDrafts } = await import(draftPath) as typeof import('../src/features/chat/stores/composerDrafts');
    return useComposerDrafts.getState().byTab[useChatStore.getState().activeConversationId]?.references?.[0];
  });
  expect(reference?.command).toBe(command);
  expect(reference?.output.length).toBeGreaterThan(2000);
  expect(reference?.output).toContain('OUTPUT_ROW_0:');
  expect(reference?.output).toContain('FINAL_OUTPUT_MARKER');
  await page.evaluate(() => {
    const scope = window as unknown as { __MODEL_REQUESTS__: string[]; __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } };
    scope.__MODEL_REQUESTS__ = [];
    const invoke = scope.__TAURI_INTERNALS__.invoke;
    scope.__TAURI_INTERNALS__.invoke = (command, args) => {
      if (command === 'llm_stream') scope.__MODEL_REQUESTS__.push((args?.req as { body?: string })?.body ?? '');
      return invoke(command, args);
    };
  });
  await page.locator('[data-chat-composer]:visible').press('Enter');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __MODEL_REQUESTS__: string[] }).__MODEL_REQUESTS__.some(body => body.includes('FINAL_OUTPUT_MARKER')))).toBe(true);
  const bodies = await page.evaluate(() => (window as unknown as { __MODEL_REQUESTS__: string[] }).__MODEL_REQUESTS__);
  const request = JSON.parse(bodies.find(body => body.includes('FINAL_OUTPUT_MARKER'))!) as { messages: { content: string | { text?: string }[] }[] };
  const content = request.messages.map(message => typeof message.content === 'string' ? message.content : message.content.map(part => part.text ?? '').join('\n')).join('\n');
  expect(content).toContain(command);
  expect(content).toContain(reference!.output);
});
