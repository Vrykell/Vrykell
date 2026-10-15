import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

for (const theme of ['深色', '浅色']) {
  test(`terminal references start expanded and share tool presentation in ${theme}`, async ({ page }, testInfo) => {
    await setupTauriMock(page, { schedulesSeed: [] });
    await page.goto('/');
    await gotoSetting(page, '主题');
    await page.getByRole('radio', { name: theme, exact: true }).click();
    await page.locator('[data-dock-btn="chat"]').click();
    await page.evaluate(async () => {
      const chatPath = '/src/features/chat/stores/chat.ts';
      const draftPath = '/src/features/chat/stores/composerDrafts.ts';
      const { useChatStore } = await import(chatPath) as typeof import('../src/features/chat/stores/chat');
      const { useComposerDrafts } = await import(draftPath) as typeof import('../src/features/chat/stores/composerDrafts');
      const reference = { id: 'snapshot', paneId: 't1#0', label: 'Build terminal · Windows PowerShell',
        command: 'npm run build', cwd: 'D:/projects/typescript/Vrykell', output: 'Build succeeded', exitCode: 0, createdAt: 1 };
      useChatStore.setState({ conversationsLoaded: true, activeConversationId: 'reference-test',
        conversations: [{ id: 'reference-test', title: 'Reference review', createdAt: 1, updatedAt: 2, environment: null }],
        byTab: { 'reference-test': [
          { id: 'q', role: 'user', content: 'Review this terminal snapshot', createdAt: 1, references: [reference] },
          { id: 'a', role: 'assistant', content: '', createdAt: 2, parts: [{ kind: 'tool', tool: {
            toolCallId: 'build-result', toolName: 'run_command', input: { command: 'npm run test' }, state: 'done' as const,
            output: JSON.stringify({ output: 'Tests passed' }), startedAt: 1,
          } }] },
        ] } });
      useComposerDrafts.getState().setReferences('reference-test', [{ ...reference, id: 'draft', command: 'codex resume', output: '' }]);
    });
    const draft = page.locator('.chat-composer .chat-reference');
    const sent = page.locator('.chat-exchange .chat-reference');
    await expect(draft.locator('.chat-reference-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(sent.locator('.chat-reference-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(draft.locator('.ai-tool-output')).toContainText('无输出');
    await expect(sent.locator('.ai-tool-output')).toHaveText('Build succeeded');
    const tool = page.locator('.chat-exchange .ai-tool-card:not(.chat-reference)');
    await tool.locator('.ai-tool-summary').click();
    expect(await sent.locator('.ai-tool-summary > svg').first().innerHTML()).toBe(await tool.locator('.ai-tool-summary > svg').first().innerHTML());
    await expect(sent).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    for (const property of ['background-color', 'border-radius', 'font-size'] as const) {
      await expect(sent.locator('.ai-tool-output')).toHaveCSS(property, await tool.locator('.ai-tool-output').evaluate((element, key) => getComputedStyle(element).getPropertyValue(key), property));
    }
    for (const property of ['font-family', 'font-size', 'line-height'] as const) {
      await expect(sent.locator('.ai-tool-output > [data-selectable]')).toHaveCSS(property,
        await tool.locator('.ai-tool-output > [data-selectable]').evaluate((element, key) => getComputedStyle(element).getPropertyValue(key), property));
    }
    await expect.poll(() => page.locator('.ai-chat-panel').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await page.locator('.ai-chat-panel').screenshot({ path: testInfo.outputPath('terminal-references-narrow.png'), animations: 'disabled' });
    await page.evaluate(async () => {
      const path = '/src/features/workspace/stores/dock.ts';
      const { useDockStore } = await import(path) as typeof import('../src/features/workspace/stores/dock');
      useDockStore.getState().setPanelWidth('chat', 520);
    });
    await page.locator('.ai-chat-panel').screenshot({ path: testInfo.outputPath('terminal-references-wide.png'), animations: 'disabled' });
    await sent.locator('.chat-reference-toggle').click();
    await expect(sent.locator('.chat-reference-body')).toHaveCount(0);
    await expect(draft.locator('.chat-reference-body')).toBeVisible();
    await draft.getByRole('button', { name: '移除引用', exact: true }).click();
    await expect(draft).toHaveCount(0);
  });
}
