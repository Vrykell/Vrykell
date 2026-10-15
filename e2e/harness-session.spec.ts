/**
 * Harness session e2e: the page opens a session against the mocked backend, renders the streamed
 * updates it pushes, and answers a permission request through the card.
 *
 * The shape of the fixtures follows the reference client's own permission tests: one builder for a
 * request, an assertion that the request stays pending until it is answered, and the answer checked
 * by what the harness receives — here, what the page sent over IPC.
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock, acpAnswered, acpCalls, emitAcpSession, acpUpdate } from './tauri-mock';

const SESSION = 'sess_e2e';

/** One permission request, shaped like the protocol's. */
function permissionRequest(toolCallId: string, title: string) {
  return {
    sessionId: SESSION,
    kind: 'permission',
    payload: {
      sessionId: SESSION,
      toolCall: { toolCallId, title },
      options: [
        { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
      ],
    },
  };
}

test.describe('harness session', () => {
  test('streams the harness output and answers its permission request', async ({ page }) => {
    await setupTauriMock(page, { schedulesSeed: [] });
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });

    // Connect the configured harness from the settings section.
    await page.keyboard.press('Control+,');
    await page.getByText('外部 harness', { exact: true }).first().click();
    await page.getByTestId('harness-connect-0').click();
    await expect(page.getByTestId('harness-send')).toBeVisible({ timeout: 10000 });
    // One tab opens one session, however many times the effects run.
    expect((await acpCalls(page)).filter((call) => call.startsWith('acp_open'))).toEqual(['acp_open:Fake ACP']);
    // 回归：严格模式下 effect 会被跑两遍，但会话只能开一次
    await expect(page.getByTestId('harness-page')).toBeVisible();

    // The agent's streamed output lands in the transcript.
    await emitAcpSession(page, acpUpdate(SESSION, {
      sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Working on it.' },
    }));
    // 诊断：页面读到什么、命令调了哪些


await expect(page.getByTestId('harness-page')).toContainText('Working on it.');

    // Its tool call shows as a row with the human-readable title the harness provided.
    await emitAcpSession(page, acpUpdate(SESSION, {
      sessionUpdate: 'tool_call', toolCallId: 'call_1', title: 'Run the tests', kind: 'execute', status: 'pending',
    }));
    await expect(page.getByTestId('harness-page')).toContainText('Run the tests');

    // A permission request becomes a card, with the options the harness itself named ...
    await emitAcpSession(page, permissionRequest('call_1', 'Run the tests'));
    const card = page.getByTestId('harness-permission');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Run the tests');
    await expect(card).toContainText('Allow once');
    // ... and nothing is answered before the click: this is the whole point of the card.
    expect(await acpAnswered(page)).toEqual([]);

    await page.getByTestId('harness-option-allow-once').click();
    // The answer reached the backend with the option the harness offered, and the card is gone.
    await expect.poll(() => acpAnswered(page)).toEqual([{ toolCallId: 'call_1', optionId: 'allow-once' }]);
    await expect(card).toHaveCount(0);

    // A second request can be refused instead, which the protocol calls a cancel.
    await emitAcpSession(page, permissionRequest('call_2', 'Delete the build output'));
    await expect(page.getByTestId('harness-permission')).toContainText('Delete the build output');
    await page.getByTestId('harness-option-deny').click();
    await expect.poll(() => acpAnswered(page)).toEqual([
      { toolCallId: 'call_1', optionId: 'allow-once' },
      { toolCallId: 'call_2', optionId: null },
    ]);
  });
});
