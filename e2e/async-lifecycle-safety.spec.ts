import { expect, test } from '@playwright/test';
import { mockAnthropic, ptyWrites, setupTauriMock, waitForWorkbench } from './tauri-mock';

test('stopping a turn drops a command waiting behind another terminal write', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/'); await waitForWorkbench(page);
  await page.locator('[data-dock-btn="chat"]').click();
  await page.evaluate(async () => {
    const chatPath = '/src/features/chat/stores/chat.ts';
    const workspacePath = '/src/features/workspace/stores/workspace.ts';
    const terminalPath = '/src/features/terminal/stores/terminal.ts';
    const queuePath = '/src/features/terminal/services/terminalWriteQueue.ts';
    const commandPath = '/src/features/agent/tools/runCommand.ts';
    const { setDefaultStream } = await import(chatPath) as typeof import('../src/features/chat/stores/chat');
    const { useWorkspaceStore } = await import(workspacePath) as typeof import('../src/features/workspace/stores/workspace');
    const { useTerminalStore } = await import(terminalPath) as typeof import('../src/features/terminal/stores/terminal');
    const { writeTerminalInput } = await import(queuePath) as typeof import('../src/features/terminal/services/terminalWriteQueue');
    const { runCommandAndWait } = await import(commandPath) as typeof import('../src/features/agent/tools/runCommand');
    const pane = `${useWorkspaceStore.getState().activeId}#0`;
    const session = useTerminalStore.getState().sessions[pane];
    const bridge = window as unknown as { releaseWrite?: () => void; drainWrite?: () => Promise<void>; __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } };
    const invoke = bridge.__TAURI_INTERNALS__.invoke;
    bridge.__TAURI_INTERNALS__.invoke = (command, args) => command === 'pty_write' && args?.data === 'blocked-before-stop'
      ? new Promise(resolve => { bridge.releaseWrite = () => resolve(undefined); }) : invoke(command, args);
    bridge.drainWrite = () => writeTerminalInput(session, 'human-after-stop');
    setDefaultStream(async (_messages, _chunk, context) => {
      void writeTerminalInput(session, 'blocked-before-stop');
      await runCommandAndWait('echo should-not-run', { paneId: pane, signal: context?.signal });
    });
  });
  const composer = page.locator('[data-chat-composer]:visible');
  await composer.fill('Run a command'); await composer.press('Enter');
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { releaseWrite?: unknown }).releaseWrite)).toBe('function');
  await page.getByRole('button', { name: '停止生成', exact: true }).click();
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0);
  await page.evaluate(async () => {
    const state = window as unknown as { releaseWrite: () => void; drainWrite: () => Promise<void> };
    state.releaseWrite(); await state.drainWrite();
  });
  const written = await ptyWrites(page);
  expect(written).not.toContain('should-not-run');
  expect(written).toContain('human-after-stop');
});

test('saving a host during an older refresh publishes the saved host after both requests finish', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/'); await waitForWorkbench(page);
  await page.getByTestId('workspace-area-ssh').click();
  await expect(page.getByTestId('ssh-row-ssh-1')).toBeVisible();
  await page.evaluate(async () => {
    const path = '/src/features/ssh/stores/store.ts';
    const { useSshStore } = await import(path) as typeof import('../src/features/ssh/stores/store');
    const bridge = window as unknown as { releaseList?: () => void; saved?: boolean; __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } };
    const invoke = bridge.__TAURI_INTERNALS__.invoke;
    let held = false;
    bridge.__TAURI_INTERNALS__.invoke = async (command, args) => {
      const result = await invoke(command, args);
      if (command === 'ssh_connections_list' && !held) {
        held = true; await new Promise<void>(resolve => { bridge.releaseList = resolve; });
      }
      if (command === 'ssh_connection_save') bridge.saved = true;
      return result;
    };
    void useSshStore.getState().load();
  });
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { releaseList?: unknown }).releaseList)).toBe('function');
  await page.getByTestId('ssh-row-ssh-1').click({ button: 'right' });
  await page.getByRole('button', { name: '编辑连接', exact: true }).click();
  await page.getByTestId('ssh-form-name').fill('Updated while loading');
  await page.getByTestId('ssh-save-btn').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { saved?: boolean }).saved)).toBe(true);
  await page.evaluate(() => (window as unknown as { releaseList: () => void }).releaseList());
  await expect(page.getByTestId('ssh-host-editor')).toHaveCount(0);
  await expect(page.getByTestId('ssh-row-ssh-1')).toContainText('Updated while loading');
});

test('a send during conversation deletion cannot recreate the persisted conversation', async ({ page }) => {
  await mockAnthropic(page, 'Saved reply'); await setupTauriMock(page);
  await page.goto('/'); await waitForWorkbench(page);
  await page.locator('[data-dock-btn="chat"]').click();
  const composer = page.locator('[data-chat-composer]:visible');
  await composer.fill('Delete this conversation'); await composer.press('Enter');
  await expect(page.getByText('Saved reply', { exact: true })).toBeVisible();
  const id = await page.evaluate(async () => {
    const path = '/src/features/chat/stores/chat.ts';
    const { useChatStore } = await import(path) as typeof import('../src/features/chat/stores/chat');
    const bridge = window as unknown as { releaseDelete?: () => void; deletion?: Promise<void>; __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } };
    const invoke = bridge.__TAURI_INTERNALS__.invoke;
    bridge.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command === 'delete_conversation') await new Promise<void>(resolve => { bridge.releaseDelete = resolve; });
      return invoke(command, args);
    };
    const state = useChatStore.getState();
    const id = state.conversations.find(conversation => state.byTab[conversation.id]?.some(message => message.content === 'Delete this conversation'))?.id;
    if (!id) throw new Error('The displayed conversation was not persisted');
    bridge.deletion = useChatStore.getState().deleteConversation(id, { activateNext: false });
    return id;
  });
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { releaseDelete?: unknown }).releaseDelete)).toBe('function');
  await composer.fill('Late message'); await composer.press('Enter');
  await page.evaluate(async () => {
    const bridge = window as unknown as { releaseDelete: () => void; deletion: Promise<void> };
    bridge.releaseDelete(); await bridge.deletion;
  });
  await expect.poll(() => page.evaluate(id => JSON.parse(localStorage.getItem('e2e-conversations') ?? '[]').some((entry: { id: string }) => entry.id === id), id)).toBe(false);
  await expect(page.getByText('Late message', { exact: true })).toHaveCount(0);
});
