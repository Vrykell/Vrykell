import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

/**
 * Tool rows mix the UI face (label) with the monospace face (path, command or ACP title).
 * Flex centring aligns the two line boxes, not their baselines, so the label used to sit a
 * little off the detail. The card must keep both texts on one baseline at every font scale.
 */
test('keeps mixed-font tool labels and details on one baseline', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('e2e-conversations', JSON.stringify([
      { id: 'tool-baseline-chat', title: 'Tool baseline', created_at: 1, updated_at: 2, environment: '{}' },
    ]));
    localStorage.setItem('e2e-conversation-messages', JSON.stringify([
      { id: 'question', conversation_id: 'tool-baseline-chat', role: 'user', content: 'Inspect the file', created_at: 1, parts: '', attachments: '', context: '{}' },
      { id: 'answer', conversation_id: 'tool-baseline-chat', role: 'assistant', content: '', created_at: 2, attachments: '', context: '{}',
        parts: JSON.stringify([
          { kind: 'tool', tool: { toolCallId: 'read', toolName: 'read', state: 'done', input: { title: "Read file 'C:\\Users\\me\\notes.txt'" }, startedAt: 1 } },
          { kind: 'tool', tool: { toolCallId: 'other', toolName: 'other', state: 'done', input: { title: 'execute' }, startedAt: 1 } },
        ]) },
    ]));
  });
  await setupTauriMock(page);
  await page.goto('/');
  await page.getByTestId('workspace-area-unified').click();
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: '全部历史', exact: true }).click();
  await page.getByTestId('unified-history-conversation:tool-baseline-chat').click();
  await expect(page.locator('.ai-tool-summary')).toHaveCount(2);

  const offsets = await page.evaluate(() => Array.from(document.querySelectorAll('.ai-tool-summary')).map(element => {
    const label = element.querySelector<HTMLElement>('.ai-tool-label')!;
    const detail = element.querySelector<HTMLElement>('.ai-tool-description')!;
    const baseline = (node: HTMLElement) => {
      const style = getComputedStyle(node);
      const context = document.createElement('canvas').getContext('2d')!;
      context.font = `${style.fontSize} ${style.fontFamily}`;
      return node.getBoundingClientRect().top + context.measureText(node.textContent ?? '').fontBoundingBoxAscent;
    };
    return Math.abs(baseline(label) - baseline(detail));
  }));
  for (const offset of offsets) expect(offset).toBeLessThanOrEqual(0.5);
});
