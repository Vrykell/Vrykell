import { expect, test } from '@playwright/test';
import { setupTauriMock, emitAcpSession, acpUpdate, acpCalls } from './tauri-mock';

for (const theme of ['dark', 'light']) for (const width of [760, 1280]) {
  test(`keeps primary agent choices visible and extra settings in the tab toolbar at ${width}px in ${theme}`, async ({ page }, info) => {
    await setupTauriMock(page, {});
    await page.addInitScript(theme => {
      localStorage.setItem('vrykell-theme-mode', theme);
      localStorage.setItem('dock-layout-v6', JSON.stringify({ layoutVersion: 6, leftZone: [], rightZone: ['chat', 'files', 'git'], leftPanels: [], rightPanels: [], panelWidths: {} }));
    }, theme);
    await page.goto('/');
    await page.getByTestId('workspace-area-ai').click();
    await page.getByTestId('harness-add-session').click();
    await page.getByTestId('acp-launcher-Fake ACP').click();
    const surface = page.locator('[data-testid="harness-page"]:visible');
    await expect(surface.getByTestId('harness-send')).toBeVisible();
    await page.setViewportSize({ width, height: 800 });
    if (width === 760) await page.locator('[data-dock-btn="chat"]').click();
    await emitAcpSession(page, acpUpdate('sess_e2e', { sessionUpdate: 'config_option_update', configOptions: [
      { id: 'mode', name: 'Permissions', type: 'select', currentValue: 'standard', options: [{ value: 'standard', name: 'Standard permissions' }] },
      { id: 'model', name: 'Model', type: 'select', currentValue: 'one', options: [{ value: 'one', name: 'A model with a very long name that must fit a narrow pane' }] },
      { id: 'collaboration_mode', name: 'Collaboration mode', type: 'select', currentValue: 'default', options: [{ value: 'default', name: 'Default collaboration' }] },
      { id: 'reasoning_effort', name: 'Reasoning effort', type: 'select', currentValue: 'medium', options: [{ value: 'medium', name: 'Medium' }, { value: 'high', name: 'High' }] },
    ] }));
    const footer = surface.locator('.chat-input-status');
    await expect(footer.getByTestId('harness-selector-config-mode')).toBeVisible();
    await expect(footer.getByTestId('harness-selector-config-model')).toBeVisible();
    expect(await footer.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await expect(surface.getByTestId('harness-selector-config-reasoning_effort')).toHaveCount(0);
    await page.getByTestId('workspace-instance-bar').getByRole('button', { name: '会话设置', exact: true }).click();
    const settings = page.getByRole('dialog', { name: '会话设置', exact: true });
    await expect(settings.getByTestId('harness-selector-config-collaboration_mode')).toBeVisible();
    const effort = settings.getByTestId('harness-selector-config-reasoning_effort');
    await effort.click();
    await page.getByRole('option', { name: 'High', exact: true }).click();
    await expect.poll(() => acpCalls(page)).toContain('acp_set_config_option:reasoning_effort=high');
    await expect(settings).toBeVisible();
    const bounds = (await settings.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`agent-settings-${theme}-${width}.png`) });
    await page.keyboard.press('Escape');
    await surface.getByTestId('harness-composer').fill('Wait for the first reply');
    await surface.getByTestId('harness-send').click();
    const loading = surface.locator('.ai-block-working[role="status"]');
    await expect(loading).toContainText('处理中');
    await expect(loading.locator('.ai-pending-cursor')).toHaveCSS('animation-name', 'pulse');
    await page.screenshot({ path: info.outputPath(`agent-working-${theme}-${width}.png`) });
    await emitAcpSession(page, { sessionId: 'sess_e2e', kind: 'error', payload: { message: 'A recoverable failure' } });
    await expect(loading).toHaveCount(0);
    await expect(surface.getByRole('alert')).toContainText('A recoverable failure');
  });
}

test('only offers return to latest after scrolling away and hides it when the reader reaches the bottom', async ({ page }) => {
  await setupTauriMock(page, {});
  await page.goto('/');
  await page.getByTestId('workspace-area-ai').click();
  await page.getByTestId('harness-add-session').click();
  await page.getByTestId('acp-launcher-Fake ACP').click();
  const surface = page.locator('[data-testid="harness-page"]:visible');
  await expect(surface.getByTestId('harness-send')).toBeVisible();
  await emitAcpSession(page, acpUpdate('sess_e2e', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'A long reply paragraph.\n\n'.repeat(120) } }));
  const transcript = surface.locator('.chat-transcript');
  const jump = surface.getByRole('button', { name: '回到最新回复', exact: true });
  await transcript.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(jump).not.toBeVisible();
  await transcript.evaluate(element => { element.scrollTop -= 18; });
  await expect(jump).not.toBeVisible();
  await transcript.evaluate(element => { element.scrollTop -= 180; });
  await expect(jump).toBeVisible();
  await transcript.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(jump).not.toBeVisible();
});
