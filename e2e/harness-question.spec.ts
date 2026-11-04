import { test, expect } from '@playwright/test';
import { setupTauriMock, emitAcpSession } from './tauri-mock';
import { gotoSetting } from './settings';

test('structured questions review multiple answers and stop removes pending forms', async ({ page }, info) => {
  await setupTauriMock(page); await page.goto('/'); await gotoSetting(page, 'ACP');
  await page.getByTestId('harness-connect-0').click();
  await expect(page.getByTestId('harness-send')).toBeVisible();
  const settings = page.getByRole('button', { name: '会话设置', exact: true });
  await settings.click();
  const menu = page.getByRole('dialog', { name: '会话设置', exact: true });
  await expect(menu.getByRole('button', { name: '关闭菜单', exact: true })).toBeVisible();
  await menu.getByRole('button', { name: '关闭菜单', exact: true }).click();
  await expect(menu).toHaveCount(0); await expect(settings).toBeFocused();
  const question = { requestId: 'question-one', form: { message: 'Which changes should be included?', fields: [
    { key: 'scope', title: 'Scope', kind: 'array', required: true, options: [{ value: 'all', label: 'All changes', description: 'Navigation, links and cache policy' }, { value: 'cache', label: 'Cache only', description: '' }], default: ['all'], description: '', minimum: null, maximum: null, minLength: 0, maxLength: 4000, minItems: 1, maxItems: 64 },
    { key: 'note', title: 'Notes', kind: 'string', required: false, options: [], default: '', description: '', minimum: null, maximum: null, minLength: 0, maxLength: 4000, minItems: 0, maxItems: 0 },
  ] } };
  await emitAcpSession(page, { sessionId: 'sess_e2e', kind: 'elicitation', payload: question });
  await expect(page.getByTestId('harness-question')).toBeVisible();
  await page.getByLabel('Cache only').check();
  await page.getByLabel('Notes', { exact: true }).fill('Keep the existing link');
  await page.setViewportSize({ width: 760, height: 900 });
  await page.screenshot({ path: info.outputPath('structured-question.png'), fullPage: true });
  await page.getByRole('button', { name: '发送回答', exact: true }).click();
  await expect(page.getByTestId('harness-question')).toHaveCount(0);
  const answers = await page.evaluate(() => (window as unknown as { __ELICITATION_ANSWERS__: unknown[] }).__ELICITATION_ANSWERS__);
  expect(answers).toEqual([{ sessionId: 'sess_e2e', requestId: 'question-one', response: { action: 'accept', content: { scope: ['all', 'cache'], note: 'Keep the existing link' } } }]);
  await emitAcpSession(page, { sessionId: 'sess_e2e', kind: 'elicitation', payload: { ...question, requestId: 'question-two' } });
  await expect(page.getByTestId('harness-question')).toBeVisible();
  await emitAcpSession(page, { sessionId: 'sess_e2e', kind: 'stop', payload: { stopReason: 'cancelled' } });
  await expect(page.getByTestId('harness-question')).toHaveCount(0);
});
