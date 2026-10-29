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
  test('shows the failure text and asks for a login only on an authentication error', async ({ page }, testInfo) => {
    await setupTauriMock(page, {});
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('Control+,');
    await page.getByText('ACP', { exact: true }).first().click();
    for (const width of [760, 1240]) {
      await page.setViewportSize({ width, height: 800 });
      const actions = page.getByTestId('harness-row-0').locator('.settings-row-actions');
      const boxes = await actions.getByRole('button').evaluateAll(elements => elements.map(element => {
        const box = element.getBoundingClientRect(); return { left: box.left, right: box.right };
      }));
      expect(boxes).toHaveLength(4);
      for (let index = 1; index < boxes.length; index++) expect(boxes[index]!.left - boxes[index - 1]!.right).toBeLessThanOrEqual(3);
      await page.getByTestId('harness-row-0').screenshot({ path: testInfo.outputPath(`server-actions-${width}.png`) });
    }
    await page.getByTestId('harness-connect-0').click();
    await expect(page.getByTestId('harness-send')).toBeVisible({ timeout: 10000 });

    // A quota failure is not a missing login: the message stays visible and no hint is invented.
    await emitAcpSession(page, {
      sessionId: SESSION, kind: 'error',
      payload: {
        message: 'agent error (-32603): API Error: 402 Insufficient Balance',
        code: -32603, authRequired: false, details: 'exit code: 1\n\nInsufficient Balance',
      },
    });
    await expect(page.locator('[data-error-notification="true"]')).toContainText('Insufficient Balance');
    await expect(page.getByTestId('harness-auth-hint')).toHaveCount(0);

    // The protocol's own authentication code gets the instructions the agent advertised.
    await emitAcpSession(page, {
      sessionId: SESSION, kind: 'error',
      payload: { message: 'agent error (-32000): Authentication required', code: -32000, authRequired: true },
    });
    await expect(page.getByTestId('harness-auth-hint')).toContainText('Run `fake login`');
  });

  test('streams the harness output and answers its permission request', async ({ page }) => {
    await setupTauriMock(page, {});
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });

    // Connect the configured harness from the settings section.
    await page.keyboard.press('Control+,');
    await page.getByText('ACP', { exact: true }).first().click();
    await page.getByTestId('harness-connect-0').click();
    await expect(page.getByTestId('harness-send')).toBeVisible({ timeout: 10000 });
    // One tab opens one session, however many times the effects run.
    expect((await acpCalls(page)).filter((call) => call.startsWith('acp_open'))).toEqual(['acp_open:Fake ACP']);
    // Regression: strict mode runs the effect twice, but only one session may open.
    await expect(page.getByTestId('harness-page')).toBeVisible();

    // The agent's modes and models arrive with the session and become quiet controls.
    await expect(page.getByTestId('harness-selector-mode')).toContainText('Default');
    await expect(page.getByTestId('harness-selector-model')).toContainText('Model One');
    await page.getByTestId('harness-selector-mode').click();
    await page.getByRole('option', { name: /Plan/ }).click();
    await expect(page.getByTestId('harness-selector-mode')).toContainText('Plan');
    await expect.poll(() => acpCalls(page)).toContain('acp_set_mode:plan');

    // The agent's streamed output lands in the transcript.
    await emitAcpSession(page, acpUpdate(SESSION, {
      sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Working on it.' },
    }));
    // Diagnostics: what the page read and which commands ran.


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

    // The plan and the context window the agent publishes belong to the session view.
    await emitAcpSession(page, acpUpdate(SESSION, {
      sessionUpdate: 'plan',
      entries: [
        { content: 'Read the failing test', status: 'completed' },
        { content: 'Fix the parser', status: 'in_progress' },
      ],
    }));
    await emitAcpSession(page, acpUpdate(SESSION, { sessionUpdate: 'usage_update', used: 12_000, size: 200_000 }));
    await expect(page.getByTestId('harness-plan')).toContainText('Fix the parser');
    await expect(page.getByTestId('harness-context')).toHaveText('1.2万/20万');

    // A mode the agent switches on its own also moves the control.
    await emitAcpSession(page, acpUpdate(SESSION, { sessionUpdate: 'current_mode_update', currentModeId: 'default' }));
    await expect(page.getByTestId('harness-selector-mode')).toContainText('Default');

    // Slash commands the agent advertises are one keystroke away.
    await emitAcpSession(page, acpUpdate(SESSION, {
      sessionUpdate: 'available_commands_update',
      availableCommands: [{ name: 'web', description: 'Search the web', input: { hint: 'query to search for' } }],
    }));
    await page.getByTestId('harness-composer').fill('/');
    await expect(page.getByTestId('harness-commands')).toContainText('/web');
    await page.getByTestId('harness-composer').press('Enter');
    await expect(page.getByTestId('harness-composer')).toHaveValue('/web ');

    // A new session drops the conversation and opens a fresh one in the same directory.
    await page.getByTestId('harness-new-session').click();
    await expect.poll(async () => (await acpCalls(page)).filter((call) => call.startsWith('acp_open'))).toHaveLength(2);
    await expect(page.locator('[data-testid="harness-page"]:visible').getByTestId('harness-plan')).toHaveCount(0);
    await expect(page.getByRole('tablist', { name: 'AI 会话' }).getByRole('tab')).toHaveCount(2);
  });
});
