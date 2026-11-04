import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

/**
 * Tool rows mix the UI face (label) with the monospace face (path, command or ACP title).
 * Labels and details share a baseline, and the complete text row stays vertically centered
 * beside its icon and status at narrow widths and larger font sizes.
 */
for (const theme of ['dark', 'light']) for (const width of [760, 1280]) for (const scale of [1, 1.5]) {
test(`centers mixed-font tool text at ${width}px and ${scale}x in ${theme}`, async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(theme => localStorage.setItem('vrykell-theme-mode', theme), theme);
  await page.addInitScript(() => {
    localStorage.setItem('e2e-conversations', JSON.stringify([
      { id: 'tool-baseline-chat', title: 'Tool baseline', created_at: 1, updated_at: 2, environment: '{}' },
    ]));
    localStorage.setItem('e2e-conversation-messages', JSON.stringify([
      { id: 'question', conversation_id: 'tool-baseline-chat', role: 'user', content: 'Inspect the file', created_at: 1, parts: '', attachments: '',
        context: JSON.stringify({ references: [{ id: 'snapshot', paneId: 't1#0', label: 'Build terminal', command: 'npm run build', output: 'Build complete', createdAt: 1 }] }) },
      { id: 'answer', conversation_id: 'tool-baseline-chat', role: 'assistant', content: '', created_at: 2, attachments: '', context: '{}',
        parts: JSON.stringify([
          { kind: 'tool', tool: { toolCallId: 'read', toolName: 'read', state: 'done', input: { title: "Read file 'C:\\Users\\me\\notes.txt'" }, startedAt: 1 } },
          { kind: 'tool', tool: { toolCallId: 'other', toolName: 'other', state: 'done', input: { title: 'execute' }, startedAt: 1 } },
          { kind: 'tool', tool: { toolCallId: 'command', toolName: 'run_command', state: 'done', input: { command: 'uptime; echo; df -h /; echo; free -h; echo; ip -4 addr show scope global | grep inet' }, output: JSON.stringify({ exitCode: 0, output: 'Command complete' }), startedAt: 1 } },
          ...['running', 'error', 'denied', 'approval-pending', 'input-pending', 'cancelled'].map(state => ({ kind: 'tool', tool: {
            toolCallId: state, toolName: state === 'input-pending' ? 'ask_user' : 'run_command', state,
            input: state === 'input-pending' ? { question: 'Choose the next step' } : { command: 'npm run check' }, startedAt: 1,
          } })),
        ]) },
    ]));
  });
  await setupTauriMock(page);
  await page.goto('/');
  await page.getByTestId('workspace-area-unified').click();
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: '全部历史', exact: true }).click();
  await page.getByTestId('unified-history-conversation:tool-baseline-chat').click();
  await expect(page.locator('.ai-tool-summary-text')).toHaveCount(9);
  await page.evaluate(async () => {
    const path = '/src/features/chat/stores/chat.ts';
    const { useChatStore } = await import(path) as typeof import('../src/features/chat/stores/chat');
    useChatStore.setState(state => ({ byTab: Object.fromEntries(Object.entries(state.byTab).map(([id, messages]) => [id, messages.map(message =>
      message.id === 'answer' ? { ...message, reasoning: 'Review the command output before choosing the next step.' } : message)])) }));
  });
  await page.setViewportSize({ width, height: 800 });
  await expect(page.locator('.ai-thinking .ai-tool-summary')).toHaveCount(1);
  await expect(page.locator('.chat-reference .ai-tool-summary')).toHaveCount(1);
  await expect(page.locator('.ai-tool-summary')).toHaveCount(11);
  await expect(page.locator('.chat-exchange > .ai-block-question').first()).toHaveCSS('border-top-left-radius', '10px');
  await expect(page.locator('.ai-tool-card:not(.ai-thinking)').first()).toHaveCSS('border-top-left-radius', '10px');
  await expect(page.locator('.terminal-composer').first()).toHaveCSS('border-top-left-radius', '10px');
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(scale => {
    document.documentElement.style.setProperty('--ui-font-scale', String(scale));
    document.documentElement.style.setProperty('--chat-font-scale', String(scale));
  }, scale);
  await expect(page.locator('.ai-tool-label').first()).toHaveCSS('font-size', `${12 * scale}px`);

  const offsets = await page.evaluate(() => Array.from(document.querySelectorAll('.ai-tool-summary')).map(element => {
    const row = element.getBoundingClientRect();
    const label = element.querySelector<HTMLElement>('.ai-tool-label');
    const detail = element.querySelector<HTMLElement>('.ai-tool-description')!;
    const texts = [label, detail].filter((node): node is HTMLElement => Boolean(node?.textContent?.trim()));
    const boxes = texts.map(node => node.getBoundingClientRect());
    const textCenter = (Math.min(...boxes.map(box => box.top)) + Math.max(...boxes.map(box => box.bottom))) / 2;
    const baseline = (node: HTMLElement) => {
      const marker = document.createElement('span');
      marker.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
      node.append(marker);
      const position = marker.getBoundingClientRect().top;
      marker.remove();
      return position;
    };
    const accessories = Array.from(element.children).filter(node => node.tagName.toLowerCase() === 'svg' || node.classList.contains('ai-tool-state'));
    return {
      baseline: label && detail.textContent?.trim() ? Math.abs(baseline(label) - baseline(detail)) : 0,
      center: Math.abs(textCenter - (row.top + row.bottom) / 2),
      accessories: accessories.map(node => { const box = node.getBoundingClientRect(); return Math.abs((box.top + box.bottom - row.top - row.bottom) / 2); }),
    };
  }));
  for (const offset of offsets) {
    expect(offset.baseline).toBeLessThanOrEqual(0.5);
    expect(offset.center).toBeLessThanOrEqual(0.5);
    for (const accessory of offset.accessories) expect(accessory).toBeLessThanOrEqual(0.5);
  }
  await page.locator('.chat-exchange').first().screenshot({ path: info.outputPath(`tool-text-${theme}-${width}-${scale}.png`) });
});
}
