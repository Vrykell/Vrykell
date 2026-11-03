import { test, expect } from '@playwright/test';
import { setupTauriMock, emitAcpSession, acpUpdate } from './tauri-mock';

for (const width of [1240, 760]) test(`streaming replies show one loading indicator at ${width}px`, async ({ page }, info) => {
  await setupTauriMock(page);
  await page.addInitScript(mode => localStorage.setItem('vrykell-theme-mode', mode), width === 760 ? 'light' : 'dark');
  await page.setViewportSize({ width: 1240, height: 800 });
  await page.goto('/');
  await page.getByTestId('workspace-area-ai').click();
  await page.getByTestId('harness-add-session').click();
  await page.getByTestId('acp-launcher-Fake ACP').click();
  const surface = page.locator('[data-testid="harness-page"]:visible');
  await expect(surface.getByTestId('harness-send')).toBeVisible();
  await page.setViewportSize({ width, height: 800 });
  await surface.getByTestId('harness-composer').fill('Explain this project.');
  await surface.getByTestId('harness-send').click();
  await expect(surface.locator('.ai-block-working')).toBeVisible();
  await expect(surface.locator('.ai-pending-cursor')).toHaveCount(1);
  await emitAcpSession(page, acpUpdate('sess_e2e', {
    sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'The project contains a terminal and a conversation workspace.' },
  }));
  await expect(surface).toContainText('The project contains a terminal');
  await expect(surface.locator('.ai-block-working')).toHaveCount(0);
  await expect(surface.locator('.ai-pending-cursor')).toHaveCount(1);
  await page.screenshot({ path: info.outputPath(`streaming-indicator-${width}.png`) });
  await emitAcpSession(page, { sessionId: 'sess_e2e', kind: 'stop', payload: { stopReason: 'end_turn' } });
  await expect(surface.locator('.ai-pending-cursor')).toHaveCount(0);
  await expect(surface.locator('.chat-answer-actions')).toHaveCount(1);
});
