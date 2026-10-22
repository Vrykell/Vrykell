import { expect, test } from '@playwright/test';
import { setupTauriMock, emitPtyOutput, ptyResizes, mockAnthropic, ptyWrites } from './tauri-mock';

for (const mode of ['global', 'remote'] as const) {
  test(`${mode} file search displays early matches and discards cancelled batches`, async ({ page }, info) => {
    await setupTauriMock(page, { integration: mode !== 'remote' });
    await page.addInitScript(() => {
      const host = window as unknown as {
        __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
        __FILE_REQUESTS__: { text: string; push: (value: unknown) => void; finish: (value: unknown) => void; cancelled: boolean }[];
      };
      host.__FILE_REQUESTS__ = [];
      const original = host.__TAURI_INTERNALS__.invoke;
      host.__TAURI_INTERNALS__.invoke = (command, args) => {
        if (command === 'search_files' || command === 'ssh_search') {
          return new Promise(resolve => {
            const channel = args?.onProgress as { onmessage: (value: unknown) => void };
            const request = { text: String(args?.query ?? args?.text), push: (value: unknown) => channel.onmessage(value), finish: resolve, cancelled: false };
            host.__FILE_REQUESTS__.push(request);
          });
        }
        if (command === 'search_files_cancel' || command === 'ssh_search_cancel') {
          const request = host.__FILE_REQUESTS__.find(item => !item.cancelled);
          if (request) request.cancelled = true;
          return Promise.resolve();
        }
        return original(command, args);
      };
    });
    await page.goto('/');
    if (mode === 'global') await page.getByTestId('global-search-trigger').click();
    else {
      await page.locator('[data-dock-btn="ssh"]').click();
      await page.getByTestId('ssh-row-ssh-1').dblclick();
      await page.locator('[data-dock-btn="files"]').click();
      await page.getByTestId('ssh-file-search-btn').click();
    }
    const input = mode === 'global' ? page.getByPlaceholder('搜索文件、命令、设置…') : page.getByRole('textbox', { name: '文件名', exact: true });
    await input.fill(mode === 'global' ? 'file: early' : 'early');
    await expect.poll(() => page.evaluate(() => (window as unknown as { __FILE_REQUESTS__: unknown[] }).__FILE_REQUESTS__.length)).toBe(1);
    const publish = async (index: number, name: string, finish = false) => page.evaluate(({ index, name, mode, finish }) => {
      const requests = (window as unknown as { __FILE_REQUESTS__: { push: (value: unknown) => void; finish: (value: unknown) => void }[] }).__FILE_REQUESTS__;
      const entries = [{ name, path: '/project/' + name, is_dir: false, size: 10, modified: 0, match_type: 'name' }];
      const batch = mode === 'global' ? entries : { entries, truncated: false, skipped: 0 };
      if (finish) requests[index].finish(batch); else requests[index].push(batch);
    }, { index, name, mode, finish });
    await publish(0, 'early.log');
    await expect(page.getByText('early.log', { exact: true })).toBeVisible();
    if (mode === 'remote') await expect(page.getByTestId('file-search-menu').getByRole('status')).toContainText('正在搜索文件');
    await page.screenshot({ path: info.outputPath(`${mode}-partial.png`) });
    await input.fill(mode === 'global' ? 'file: latest' : 'latest');
    await expect.poll(() => page.evaluate(() => (window as unknown as { __FILE_REQUESTS__: { cancelled: boolean }[] }).__FILE_REQUESTS__[0].cancelled)).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __FILE_REQUESTS__: unknown[] }).__FILE_REQUESTS__.length)).toBe(2);
    await publish(0, 'obsolete.log');
    await publish(0, 'obsolete.log', true);
    await expect(page.getByText('obsolete.log', { exact: true })).toHaveCount(0);
    await publish(1, 'latest.log');
    await expect(page.getByText('latest.log', { exact: true })).toBeVisible();
    await publish(1, 'latest.log', true);
    await input.press('Escape');
  });
}

test('a running log uses its visible host width even when the hidden terminal has a different grid', async ({ page }, info) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.locator('[data-terminal-input]')).toBeVisible();
  await page.waitForFunction(async () => {
    const path = '/src/features/terminal/stores/terminal.ts';
    const { useTerminalStore } = await import(path) as typeof import('../src/features/terminal/stores/terminal');
    return Object.values(useTerminalStore.getState().startupStates).includes('ready');
  });
  await emitPtyOutput(page, `\x1b]133;E;${btoa('tail -f sample.log')}\x07\x1b]133;C\x07${'log-output '.repeat(40)}\r\n`);
  const host = page.getByTestId('running-term');
  await expect(host.locator('.xterm-screen')).toBeVisible();
  await page.evaluate(async () => {
    const terms = (window as unknown as { __vrykellTerms: Map<string, import('@xterm/xterm').Terminal> }).__vrykellTerms;
    const main = [...terms.entries()].find(([key]) => !key.startsWith('block:'))![1];
    main.options.fontSize = 28;
    const path = '/src/features/terminal/hooks/useTerminalSession.ts';
    const { syncTermWidth } = await import(path) as typeof import('../src/features/terminal/hooks/useTerminalSession');
    const blockId = [...terms.keys()].find(key => key.startsWith('block:'))!.slice(6);
    syncTermWidth(blockId);
  });
  for (const width of [1500, 760]) {
    await page.setViewportSize({ width, height: 850 });
    await expect(async () => {
      const grid = await host.evaluate(element => {
        const terms = (window as unknown as { __vrykellTerms: Map<string, import('@xterm/xterm').Terminal> }).__vrykellTerms;
        const block = [...terms.entries()].find(([key]) => key.startsWith('block:'))![1];
        const screen = element.querySelector('.xterm-screen')!.getBoundingClientRect().width;
        return { cols: block.cols, screen, available: element.clientWidth, cell: screen / block.cols };
      });
      expect(grid.available - grid.screen).toBeGreaterThanOrEqual(-1);
      expect(grid.available - grid.screen).toBeLessThan(grid.cell + 1);
      expect((await ptyResizes(page)).at(-1)?.cols).toBe(grid.cols);
    }).toPass();
    await page.screenshot({ path: info.outputPath(`running-width-${width}.png`) });
  }
});

test('sending only a pasted attachment renders the attachment without an empty question bubble', async ({ page }, info) => {
  await mockAnthropic(page, 'Log received.');
  await setupTauriMock(page);
  await page.goto('/');
  await page.locator('[data-dock-btn="chat"]').click();
  const composer = page.locator('[data-chat-composer]');
  await composer.evaluate(element => {
    const data = new DataTransfer();
    data.setData('text/plain', 'pasted diagnostic line\n'.repeat(80));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(composer).toHaveValue('');
  await expect(page.locator('.chat-context-tray .chat-attachment-chip')).toHaveCount(1);
  await composer.press('Enter');
  await expect(page.getByText('Log received.', { exact: true })).toBeVisible();
  const exchange = page.locator('.chat-exchange').last();
  await expect(exchange.locator('.ai-block-question')).toHaveCount(0);
  await expect(exchange.locator('.chat-attachment-chip')).toHaveCount(1);
  await page.screenshot({ path: info.outputPath('attachment-only.png') });
});

test('a remote permission-limited file offers a separate elevated editing terminal', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await page.locator('[data-dock-btn="ssh"]').click();
  await page.getByTestId('ssh-row-ssh-1').dblclick();
  await page.evaluate(async () => {
    const host = window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } };
    const original = host.__TAURI_INTERNALS__.invoke;
    host.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command === 'editor_read_file') return { kind: 'text', text: 'protected config', revision: 'remote-version', readOnly: true, permissionDenied: true };
      return original(command, args);
    };
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    useWorkspaceStore.getState().openEditorFile({ path: '/etc/config.conf', connectionId: 'ssh-1' });
  });
  const editor = page.getByTestId('file-editor');
  await expect(editor.locator('.editor-readonly-label')).toHaveText('只读');
  await expect(page.getByTestId('workspace-instance-bar').getByRole('button', { name: '保存文件', exact: true })).toBeDisabled();
  const before = (await ptyWrites(page)).length;
  await editor.getByRole('button', { name: '只读', exact: true }).click();
  await page.getByText('使用 sudo 在终端编辑', { exact: true }).click();
  await expect.poll(async () => (await ptyWrites(page)).slice(before).join('')).toContain("sudoedit -- '/etc/config.conf'\n");
});
