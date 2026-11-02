import { expect, test, type Page } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { gotoSetting } from './settings';

type Mode = 'available' | 'current' | 'offline' | 'signature';
interface Fixture { mode: Mode; checks: number; downloads: number; installs: number; restarts: number; closes: number; finish?: () => void; }
async function openAbout(page: Page, theme: 'dark' | 'light' = 'dark', mode: Mode = 'available') {
  await setupTauriMock(page, { integration: false });
  await page.addInitScript(({ theme, mode }) => {
    localStorage.setItem('vrykell-theme-mode', theme);
    const root = window as unknown as { isTauri: boolean; __UPDATE_FIXTURE__: Fixture; __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } };
    root.isTauri = true;
    const fixture = root.__UPDATE_FIXTURE__ = { mode, checks: 0, downloads: 0, installs: 0, restarts: 0, closes: 0 };
    const original = root.__TAURI_INTERNALS__.invoke;
    root.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command === 'plugin:app|version') return '0.1.0';
      if (command === 'plugin:updater|check') {
        fixture.checks += 1;
        if (fixture.mode === 'offline') throw new Error('The stable release feed is unavailable');
        return fixture.mode === 'current' ? null : { rid: 501, currentVersion: '0.1.0', version: '0.2.0', body: 'Release notes\n<script>fixture</script>', rawJson: {} };
      }
      if (command === 'plugin:updater|download') {
        fixture.downloads += 1;
        const channel = args?.onEvent as { onmessage: (event: unknown) => void };
        channel.onmessage({ event: 'Started', data: { contentLength: 100 } });
        channel.onmessage({ event: 'Progress', data: { chunkLength: 25 } });
        return new Promise<number>((resolve, reject) => {
          fixture.finish = () => {
            channel.onmessage({ event: 'Progress', data: { chunkLength: 75 } });
            channel.onmessage({ event: 'Finished' });
            if (fixture.mode === 'signature') reject(new Error('Update signature verification failed'));
            else resolve(777);
          };
        });
      }
      if (command === 'plugin:updater|install') { fixture.installs += 1; return; }
      if (command === 'plugin:process|restart') { fixture.restarts += 1; return; }
      if (command === 'pty_close_all') { fixture.closes += 1; return 0; }
      return original(command, args);
    };
  }, { theme, mode });
  await page.goto('/');
  await gotoSetting(page, '关于');
  await expect(page.getByTestId('application-version')).toHaveText('0.1.0');
}
async function state(page: Page) { return page.evaluate(() => (window as unknown as { __UPDATE_FIXTURE__: Fixture }).__UPDATE_FIXTURE__); }
async function finishDownload(page: Page) { await page.evaluate(() => (window as unknown as { __UPDATE_FIXTURE__: Fixture }).__UPDATE_FIXTURE__.finish?.()); }

for (const [theme, width] of [['dark', 1240], ['light', 720]] as const) {
  test(`about page checks, downloads and explicitly installs stable updates in ${theme}`, async ({ page }, info) => {
    await openAbout(page, theme);
    const initialCloses = (await state(page)).closes;
    await page.setViewportSize({ width, height: 800 });
    await expect(page.locator('.settings-save-hint')).toBeHidden();
    await page.locator('.settings-view').screenshot({ path: info.outputPath(`about-${theme}.png`), animations: 'disabled' });
    await page.getByRole('button', { name: '检查更新', exact: true }).click();
    await expect(page.getByText('发现新版本 0.2.0。', { exact: true })).toBeVisible();
    await expect(page.getByText('<script>fixture</script>', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: '下载更新', exact: true }).click();
    await expect(page.getByRole('progressbar', { name: '更新下载进度' })).toHaveAttribute('aria-valuenow', '25');
    await page.locator('.settings-navigation').getByRole('button', { name: '语言', exact: true }).click();
    await page.locator('.settings-navigation').getByRole('button', { name: '关于', exact: true }).click();
    await expect(page.getByRole('button', { name: '正在下载…', exact: true })).toBeDisabled();
    expect((await state(page)).checks).toBe(1);
    await finishDownload(page);
    await page.getByRole('button', { name: '安装并重启', exact: true }).click();
    await page.getByRole('button', { name: '稍后', exact: true }).click();
    expect((await state(page)).installs).toBe(0);
    expect((await state(page)).closes).toBe(initialCloses);
    await page.evaluate(() => document.documentElement.style.setProperty('--ui-font-scale', '1.25'));
    await page.locator('.settings-view').screenshot({ path: info.outputPath(`about-ready-${theme}-125.png`), animations: 'disabled' });
    await page.getByRole('button', { name: '安装并重启', exact: true }).click();
    await page.getByTestId('confirm-ok').click();
    await expect.poll(async () => (await state(page)).restarts).toBe(1);
    expect(await state(page)).toMatchObject({ downloads: 1, installs: 1, closes: initialCloses + 1 });
  });
}

test('failed update checks remain retryable without claiming the application is current', async ({ page }) => {
  await openAbout(page, 'dark', 'offline');
  await page.getByRole('button', { name: '检查更新', exact: true }).click();
  await expect(page.locator('#app-notifications').getByRole('alert')).toContainText('软件更新失败');
  await expect(page.getByText('当前已是最新正式版。')).toHaveCount(0);
  await page.clock.install();
  await page.clock.fastForward(60000);
  await expect(page.locator('#app-notifications').getByRole('alert')).toBeVisible();
  await page.evaluate(() => { (window as unknown as { __UPDATE_FIXTURE__: Fixture }).__UPDATE_FIXTURE__.mode = 'current'; });
  await page.locator('#app-notifications').getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByText('当前已是最新正式版。', { exact: true })).toBeVisible();
});

test('signature failures never offer installation or restart', async ({ page }) => {
  await openAbout(page, 'dark', 'signature');
  const initialCloses = (await state(page)).closes;
  await page.getByRole('button', { name: '检查更新', exact: true }).click();
  await page.getByRole('button', { name: '下载更新', exact: true }).click();
  await finishDownload(page);
  await expect(page.locator('#app-notifications').getByRole('alert')).toContainText('软件更新失败');
  await expect(page.getByRole('button', { name: '安装并重启', exact: true })).toHaveCount(0);
  expect(await state(page)).toMatchObject({ installs: 0, restarts: 0, closes: initialCloses });
});

test('cancelling the unsaved-document guard keeps drafts and terminal connections', async ({ page }) => {
  await openAbout(page);
  const initialCloses = (await state(page)).closes;
  await page.evaluate(async () => {
    const actionsPath = '/src/features/editor/services/documentActions.ts';
    const documentsPath = '/src/features/editor/stores/documents.ts';
    const { newEditorFile } = await import(actionsPath) as typeof import('../src/features/editor/services/documentActions');
    const { useEditorDocuments } = await import(documentsPath) as typeof import('../src/features/editor/stores/documents');
    newEditorFile();
    const draft = Object.values(useEditorDocuments.getState().documents).find(document => !!document.file.draftId)!;
    useEditorDocuments.getState().edit(draft.file, 'Keep this draft during updates');
  });
  await gotoSetting(page, '关于');
  await page.getByRole('button', { name: '检查更新', exact: true }).click();
  await page.getByRole('button', { name: '下载更新', exact: true }).click();
  await finishDownload(page);
  await page.getByRole('button', { name: '安装并重启', exact: true }).click();
  await page.getByTestId('confirm-ok').click();
  const guard = page.getByRole('dialog', { name: '未保存的更改' });
  await expect(guard).toBeVisible();
  await guard.getByRole('button', { name: '取消', exact: true }).click();
  await expect(guard).toHaveCount(0);
  expect(await state(page)).toMatchObject({ installs: 0, restarts: 0, closes: initialCloses });
  expect(await page.evaluate(async () => {
    const path = '/src/features/editor/stores/documents.ts';
    const { useEditorDocuments } = await import(path) as typeof import('../src/features/editor/stores/documents');
    return Object.values(useEditorDocuments.getState().documents).some(document => document.value === 'Keep this draft during updates');
  })).toBe(true);
});
