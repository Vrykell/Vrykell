import { expect, test, type Page } from '@playwright/test';
import { setupTauriMock, waitForWorkbench } from './tauri-mock';

async function setupNativeDropMock(page: Page) {
  await setupTauriMock(page, {});
  await page.addInitScript(() => {
    type Upload = { id: string; remoteDir: string; localPath: string };
    const host = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
        emitEvent: (event: string, payload: unknown) => void;
      };
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: (event: string, id: number) => void };
      __FOLDER_UPLOADS__: Upload[];
      __ATTACHMENT_IMPORTS__: string[];
    };
    const api = host.__TAURI_INTERNALS__;
    const originalInvoke = api.invoke;
    const originalEmit = api.emitEvent;
    const originalUnregister = host.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener;
    const listeners = new Map<number, { event: string; handler: number }>();
    host.__FOLDER_UPLOADS__ = [];
    host.__ATTACHMENT_IMPORTS__ = [];
    host.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener = (event, id) => {
      if (event.startsWith('tauri://drag-')) listeners.delete(id);
      else originalUnregister(event, id);
    };
    api.invoke = async (command, args) => {
      const event = typeof args?.event === 'string' ? args.event : '';
      if (command === 'plugin:event|listen' && event.startsWith('tauri://drag-')) {
        const handler = Number(args?.handler);
        listeners.set(handler, { event, handler });
        await new Promise(resolve => setTimeout(resolve, 0));
        return handler;
      }
      if (command === 'plugin:event|unlisten' && event.startsWith('tauri://drag-')) return undefined;
      if (command === 'ssh_upload') {
        host.__FOLDER_UPLOADS__.push({ id: String(args?.id), remoteDir: String(args?.remoteDir), localPath: String(args?.localPath) });
        return `${String(args?.remoteDir)}/project-folder`;
      }
      if (command === 'import_attachment') host.__ATTACHMENT_IMPORTS__.push(String(args?.path));
      return originalInvoke(command, args);
    };
    api.emitEvent = (event, payload) => {
      if (!event.startsWith('tauri://drag-')) return originalEmit(event, payload);
      for (const [id, listener] of [...listeners]) {
        if (listener.event !== event) continue;
        const callback = (window as unknown as Record<string, (value: unknown) => void>)[`_${listener.handler}`];
        callback?.({ event, id, payload });
      }
    };
  });
}

test('uploads a dragged folder once per drop after returning from the transfer manager', async ({ page }) => {
  await setupNativeDropMock(page);
  await page.goto('/');
  await waitForWorkbench(page);
  await page.evaluate(async () => {
    const modulePath = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(modulePath) as typeof import('../src/features/workspace/stores/workspace');
    useWorkspaceStore.getState().addTab({ kind: 'ssh', ssh: { connectionId: 'ssh-1', host: 'prod.example.com', user: 'root', name: 'Remote' } });
  });
  if (!await page.getByTestId('remote-file-tree').isVisible()) await page.locator('[data-dock-btn="files"]').click();
  const tree = page.getByTestId('remote-file-tree');
  await expect(tree).toHaveAttribute('data-path', '/home/root');

  const uploads = () => page.evaluate(() => (window as unknown as {
    __FOLDER_UPLOADS__: { id: string; remoteDir: string; localPath: string }[];
  }).__FOLDER_UPLOADS__);
  const dropFolder = async (point: { x: number; y: number }) => {
    await page.evaluate(({ x, y }) => {
      const api = (window as unknown as { __TAURI_INTERNALS__: { emitEvent: (event: string, payload: unknown) => void } }).__TAURI_INTERNALS__;
      const payload = { paths: ['C:\\projects\\project-folder'], position: { x: x * devicePixelRatio, y: y * devicePixelRatio } };
      api.emitEvent('tauri://drag-enter', payload);
      api.emitEvent('tauri://drag-drop', payload);
    }, point);
    await expect(page.getByTestId('downloads-back')).toBeVisible();
  };

  const directory = await page.getByTestId('remote-file-Documents').boundingBox();
  if (!directory) throw new Error('Remote directory is unavailable');
  await dropFolder({ x: directory.x + directory.width / 2, y: directory.y + directory.height / 2 });
  await expect.poll(uploads).toEqual([{ id: 'ssh-1', remoteDir: '/home/root/Documents', localPath: 'C:\\projects\\project-folder' }]);

  for (const count of [2, 3]) {
    await page.getByTestId('downloads-back').click();
    await expect(tree).toHaveAttribute('data-path', '/home/root');
    const bounds = await tree.boundingBox();
    if (!bounds) throw new Error('Remote file tree is unavailable');
    await dropFolder({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height - 12 });
    await expect.poll(async () => (await uploads()).length).toBe(count);
    expect((await uploads()).at(-1)).toEqual({ id: 'ssh-1', remoteDir: '/home/root', localPath: 'C:\\projects\\project-folder' });
  }
});

test('imports one attachment per native drop after repeatedly reopening the panel', async ({ page }) => {
  await setupNativeDropMock(page);
  await page.goto('/');
  await page.getByRole('button', { name: '询问 AI', exact: true }).click();
  const composer = page.locator('[data-chat-composer]:visible');
  const drop = async () => {
    const bounds = await composer.boundingBox();
    if (!bounds) throw new Error('Conversation composer is unavailable');
    await page.evaluate(({ x, y }) => {
      const api = (window as unknown as { __TAURI_INTERNALS__: { emitEvent: (event: string, payload: unknown) => void } }).__TAURI_INTERNALS__;
      api.emitEvent('tauri://drag-drop', { paths: ['/local/notes.txt'], position: { x: x * devicePixelRatio, y: y * devicePixelRatio } });
    }, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
  };
  const imports = () => page.evaluate(() => (window as unknown as { __ATTACHMENT_IMPORTS__: string[] }).__ATTACHMENT_IMPORTS__);

  await drop();
  await expect(page.locator('.chat-context-tray .chat-attachment-chip')).toHaveCount(1);
  expect(await imports()).toEqual(['/local/notes.txt']);
  await page.locator('[data-dock-btn="chat"]').click();
  await expect(composer).not.toBeVisible();
  await page.locator('[data-dock-btn="chat"]').click();
  await expect(composer).toBeVisible();
  await drop();
  await expect(page.locator('.chat-context-tray .chat-attachment-chip')).toHaveCount(2);
  expect(await imports()).toHaveLength(2);

  await page.locator('[data-dock-btn="chat"]').click();
  await expect(composer).not.toBeVisible();
  await page.locator('[data-dock-btn="chat"]').click();
  await expect(composer).toBeVisible();
  await drop();
  await expect(page.locator('.chat-context-tray .chat-attachment-chip')).toHaveCount(3);
  expect(await imports()).toHaveLength(3);
});
