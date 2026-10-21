import { expect, test, type Page } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
test.setTimeout(60_000);
test.beforeEach(async ({ page }) => {
  await setupTauriMock(page.context(), { launchDirectory: '/home/e2e/project', terminalDirectories: true, schedulesSeed: [] });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '版本控制', exact: true }).click();
});
async function openWorking(page: Page, path = 'src/main.ts', scope = 'unstaged') {
  const row = page.getByTestId(`git-${scope}-${path}`); await row.hover(); await row.getByRole('button', { name: '打开工作文件' }).click();
  await expect(page.getByTestId('file-editor').locator('.monaco-editor')).toBeVisible({ timeout: 15_000 });
}
async function replaceText(page: Page, text: string) {
  const input = page.getByTestId('file-editor').locator('textarea.inputarea'); await input.focus(); await page.keyboard.press('Control+a'); await page.keyboard.insertText(text);
}

test('identifies read-only files, blocks normal edits and offers explicit administrator opening', async ({ page }, info) => {
  await page.evaluate(() => {
    const host = window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> }; __ELEVATED_FILE__?: unknown; __EDITOR_SAVE_COUNT__?: number; __WRITABLE__?: boolean };
    const original = host.__TAURI_INTERNALS__.invoke;
    host.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command === 'editor_open_elevated') { host.__ELEVATED_FILE__ = args?.target; return; }
      if (command === 'editor_save_file') host.__EDITOR_SAVE_COUNT__ = (host.__EDITOR_SAVE_COUNT__ ?? 0) + 1;
      const result = await original(command, args);
      if (command === 'editor_read_file') return { ...(result as Record<string, unknown>), readOnly: !host.__WRITABLE__, permissionDenied: !host.__WRITABLE__ };
      return result;
    };
  });
  await openWorking(page);
  const editor = page.getByTestId('file-editor');
  await expect(editor.locator('.editor-readonly-label')).toHaveText('只读');
  await expect(editor.getByText(/当前用户无权读取或写入此文件/)).toHaveCount(0);
  await expect(page.getByRole('menu', { name: '文件权限' })).toHaveCount(0);
  const before = await editor.locator('.view-lines').innerText();
  await replaceText(page, 'blocked edit');
  await page.keyboard.press('Control+s');
  expect(await editor.locator('.view-lines').innerText()).toBe(before);
  expect(await page.evaluate(() => (window as unknown as { __EDITOR_SAVE_COUNT__?: number }).__EDITOR_SAVE_COUNT__ ?? 0)).toBe(0);
  await expect(page.getByTestId('workspace-instance-bar').getByRole('button', { name: '保存文件', exact: true })).toBeDisabled();
  for (const width of [1240, 760]) {
    await page.setViewportSize({ width, height: 800 });
    await editor.getByRole('button', { name: '只读', exact: true }).click();
    const access = page.getByRole('menu', { name: '文件权限' });
    await expect(access.getByText(/当前用户无权读取或写入此文件/)).toBeVisible();
    const bounds = (await access.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`readonly-${width}.png`) });
    await page.keyboard.press('Escape');
    await expect(editor.getByRole('button', { name: '只读', exact: true })).toBeFocused();
  }
  await editor.getByRole('button', { name: '只读', exact: true }).click();
  await page.getByRole('menu', { name: '文件权限' }).getByRole('button', { name: '以管理员权限打开', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { __ELEVATED_FILE__?: unknown }).__ELEVATED_FILE__)).toMatchObject({ path: '/home/e2e/project/src/main.ts' });
  await page.evaluate(() => { (window as unknown as { __WRITABLE__: boolean }).__WRITABLE__ = true; });
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: '更多编辑器操作' }).click();
  await page.getByRole('menu').getByRole('button', { name: '重新加载文件', exact: true }).click();
  await expect(editor.locator('.editor-readonly-label')).toHaveCount(0);
  await replaceText(page, 'allowed after reload');
  await expect(editor.locator('.view-lines')).toContainText('allowed after reload');
});

test('opens text in the built-in editor, saves it and guards unsaved closes', async ({ page }, info) => {
  await openWorking(page);
  const editor = page.getByTestId('file-editor'); await replaceText(page, 'export const value = "saved";');
  await expect(page.getByTestId('workspace-instance-bar').getByRole('button', { name: '保存文件', exact: true })).toBeEnabled();
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('workspace-instance-bar').getByRole('button', { name: '保存文件', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mock-editor-files')!)['["","/home/e2e/project/src/main.ts"]'])).toContain('saved');
  for (const width of [1240, 760]) { await page.setViewportSize({ width, height: 800 }); await page.screenshot({ path: info.outputPath(`editor-${width}.png`) }); }
  await replaceText(page, 'unsaved draft'); await page.keyboard.press('Control+w');
  let dialog = page.getByRole('dialog', { name: '未保存的更改' }); await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '取消', exact: true }).click(); await expect(editor).toBeVisible();
  await page.keyboard.press('Control+w'); dialog = page.getByRole('dialog', { name: '未保存的更改' });
  await dialog.getByRole('button', { name: '保存并关闭' }).click(); await expect(editor).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mock-editor-files')!)['["","/home/e2e/project/src/main.ts"]'])).toContain('unsaved draft');
});

test('retains drafts on disk conflicts and requires confirmation before reload', async ({ page }) => {
  await openWorking(page); const editor = page.getByTestId('file-editor'); await replaceText(page, 'local draft');
  await page.evaluate(() => localStorage.setItem('mock-editor-files', JSON.stringify({ '["","/home/e2e/project/src/main.ts"]': 'external text' })));
  await page.keyboard.press('Control+s'); await expect(editor.getByRole('alert')).toBeVisible();
  await expect(editor.locator('.view-lines')).toContainText('local draft');
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: '重新加载文件' }).click(); await page.getByTestId('confirm-cancel').click();
  await expect(editor.locator('.view-lines')).toContainText('local draft');
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: '重新加载文件' }).click(); await page.getByTestId('confirm-ok').click();
  await expect(editor.locator('.view-lines')).toContainText('external text');
});

test('keeps files in a single page despite a legacy preference and offers terminal opening', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('vrykell-editor-preferences', JSON.stringify({ state: { pageMode: 'multiple' }, version: 0 })));
  await page.reload();
  if (!await page.getByTestId('git-panel').isVisible()) await page.getByRole('button', { name: '版本控制', exact: true }).click();
  await openWorking(page); await replaceText(page, 'keep this buffer');
  await openWorking(page, 'new file.ts', 'untracked');
  await expect(page.getByRole('tablist', { name: '已打开的文件与比较' }).getByRole('tab')).toHaveCount(2);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '本地编辑器', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '编辑器页面' })).toHaveCount(0);
  await page.getByRole('button', { name: '远程编辑器', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '编辑器页面' })).toHaveCount(0);
  await page.getByRole('button', { name: '本地编辑器', exact: true }).click();
  await page.getByRole('combobox', { name: '首选文件编辑器' }).click(); await page.getByRole('option', { name: '终端编辑器', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('vrykell-editor-preferences')!).state.localOpenMode)).toBe('terminal');
  await page.evaluate(async () => {
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    const editor = useWorkspaceStore.getState().tabs.find(tab => tab.kind === 'editor');
    if (editor) useWorkspaceStore.getState().activate(editor.id);
  });
  await page.getByRole('tab', { name: 'main.ts •', exact: true }).click();
  await expect(page.getByTestId('file-editor').locator('.view-lines')).toContainText('keep this buffer');
  await expect(page.getByRole('tablist', { name: '已打开的文件与比较' }).getByRole('tab')).toHaveCount(2);
});

test('returns from a comparison to its editor and explains binary files', async ({ page }) => {
  await openWorking(page);
  await page.getByTestId('git-unstaged-src/main.ts').click();
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: '更多编辑器操作' }).click();
  await page.getByRole('button', { name: '返回编辑器', exact: true }).click();
  await expect(page.getByTestId('file-editor')).toBeVisible();
  const image = page.getByTestId('git-unstaged-image.png'); await image.hover(); await image.getByRole('button', { name: '打开工作文件' }).click();
  await expect(page.getByTestId('file-editor').getByText('此文件是二进制或非 UTF-8 文本，请使用其他编辑器打开。')).toBeVisible();
});

test('reorders connected file tabs and keeps compact actions above the text', async ({ page }, info) => {
  await openWorking(page); await openWorking(page, 'new file.ts', 'untracked');
  const strip = page.getByRole('tablist', { name: '已打开的文件与比较' });
  const source = (await strip.getByRole('tab').nth(1).boundingBox())!; const target = (await strip.getByRole('tab').first().boundingBox())!;
  await page.mouse.move(source.x + 28, source.y + source.height / 2); await page.mouse.down();
  await page.mouse.move(target.x + 10, target.y + target.height / 2, { steps: 12 });
  const slot = page.locator('[data-reorder-placeholder]'); await expect(slot).toBeVisible();
  expect(await slot.evaluate(element => getComputedStyle(element).borderStyle)).toBe('none');
  const preview = page.locator('[data-reorder-preview="item"]');
  await expect(preview).toBeVisible(); await expect(preview).toContainText('new file.ts');
  const previewBounds = (await preview.boundingBox())!;
  expect(previewBounds.height).toBe(34);
  expect(previewBounds.y).toBe(source.y - 3);
  await page.mouse.up();
  await expect(strip.getByRole('tab').first()).toContainText('new file.ts');
  await expect(strip.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
  const header = page.getByTestId('workspace-instance-bar').locator('.folder-header');
  expect((await header.boundingBox())!.height).toBeLessThanOrEqual(34);
  const first = strip.locator('.folder-tab').first();
  expect((await first.boundingBox())!.x).toBe((await strip.boundingBox())!.x + 10);
  expect(await first.evaluate(element => getComputedStyle(element, '::before').content)).toBe('""');
  const inactive = strip.locator('.folder-tab').nth(1); await inactive.hover();
  const hover = (await inactive.locator('.folder-tab-content').boundingBox())!; const row = (await inactive.boundingBox())!;
  expect(hover.y).toBeGreaterThan(row.y); expect(hover.y + hover.height).toBeLessThan(row.y + row.height);
  expect(await inactive.locator('.folder-tab-content').evaluate(element => parseFloat(getComputedStyle(element).borderBottomLeftRadius))).toBeGreaterThan(0);
  expect(await inactive.evaluate(element => getComputedStyle(element, '::before').content)).toBe('none');
  const editor = page.getByTestId('file-editor');
  for (const width of [1240, 760]) {
    await page.setViewportSize({ width, height: 800 });
    const path = (await editor.locator('.folder-path').boundingBox())!; const body = (await editor.locator('.code-editor-frame').boundingBox())!;
    expect(path.height).toBeLessThanOrEqual(26); expect(path.y + path.height).toBeLessThanOrEqual(body.y + 1);
    expect(await strip.locator('.folder-tab[data-active="true"]').evaluate(element => getComputedStyle(element).backgroundColor)).toBe(await editor.locator('.code-editor-frame').evaluate(element => getComputedStyle(element).backgroundColor));
    await page.screenshot({ path: info.outputPath(`folder-tabs-${width}.png`) });
  }
  await page.setViewportSize({ width: 560, height: 800 });
  await expect(page.getByTestId('workspace-instance-bar').getByRole('button', { name: '在终端中打开', exact: true })).not.toBeVisible();
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: '更多编辑器操作' }).click();
  await expect(page.getByRole('menu').getByRole('button', { name: '在终端中打开', exact: true })).toBeVisible();
});

test('dragging the selected first file leaves the remaining tabs visible in a narrow strip', async ({ page }, info) => {
  const longPath = 'src/selected-first-document-with-a-long-name.ts';
  await page.evaluate(path => localStorage.setItem('mock-git-snapshot', JSON.stringify({
    root: '/home/e2e/project', branch: 'main', entries: [path, 'second.ts'].map(path => ({ path, previousPath: null, indexStatus: ' ', worktreeStatus: 'M' })),
  })), longPath);
  await page.getByRole('button', { name: '刷新变更' }).click();
  await openWorking(page, longPath); await openWorking(page, 'second.ts'); await openWorking(page, longPath);
  await page.setViewportSize({ width: 760, height: 800 });
  const strip = page.getByRole('tablist', { name: '已打开的文件与比较' });
  const first = strip.getByRole('tab').first(); const second = strip.getByRole('tab', { name: 'second.ts', exact: true });
  await expect(first).toHaveAttribute('aria-selected', 'true');
  const source = (await first.boundingBox())!;
  await page.mouse.move(source.x + 24, source.y + source.height / 2); await page.mouse.down();
  await page.mouse.move(source.x + 36, source.y + source.height / 2, { steps: 4 });
  const slot = strip.locator('[data-reorder-placeholder]'); await expect(slot).toBeVisible();
  await expect(second).toBeInViewport();
  const preview = page.locator('[data-reorder-preview="item"]');
  await expect(preview).toContainText('selected-first-document');
  await expect(preview.locator('.folder-tab')).toHaveCSS('background-color', await strip.locator('.folder-tab[data-active="true"]').evaluate(element => getComputedStyle(element).backgroundColor));
  expect(await preview.locator('.folder-tab').evaluate(element => getComputedStyle(element, '::before').content)).toBe('""');
  const start = (await preview.boundingBox())!;
  await page.mouse.move(source.x + 66, source.y + source.height / 2 + 12, { steps: 4 });
  const moved = (await preview.boundingBox())!;
  expect(moved.x).toBeGreaterThan(start.x); expect(moved.y).toBe(start.y);
  const destination = (await slot.boundingBox())!; const remaining = (await second.boundingBox())!;
  expect(remaining.x - destination.x - destination.width).toBeLessThan(12);
  await page.screenshot({ path: info.outputPath('selected-first-file-drag.png') });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(strip.getByRole('tab')).toHaveCount(2);
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await expect(first).toContainText('selected-first-document');
  await expect(preview).toHaveCount(0);
});

for (const direction of ['left', 'right']) {
  test(`selects on press and exchanges unequal tabs to the ${direction} after half an overlap`, async ({ page }, info) => {
    const middle = 'src/document-with-a-much-longer-name-than-its-neighbors.ts';
    const paths = ['first.ts', middle, 'last.ts'];
    await page.evaluate(paths => localStorage.setItem('mock-git-snapshot', JSON.stringify({
      root: '/home/e2e/project', branch: 'main', entries: paths.map(path => ({ path, previousPath: null, indexStatus: ' ', worktreeStatus: 'M' })),
    })), paths);
    await page.getByRole('button', { name: '刷新变更' }).click();
    for (const path of paths) await openWorking(page, path);
    await openWorking(page, direction === 'left' ? paths[0]! : paths[2]!);
    const strip = page.getByRole('tablist', { name: '已打开的文件与比较' });
    const source = strip.getByRole('tab', { name: middle.split('/').pop()!, exact: true });
    const sourceRow = (await strip.locator('.folder-tab').nth(1).boundingBox())!;
    const button = (await source.boundingBox())!;
    const grabX = direction === 'left' ? button.x + button.width - 4 : button.x + 4;
    const y = button.y + button.height / 2;
    await expect(source).toHaveAttribute('aria-selected', 'false');
    await page.mouse.move(grabX, y); await page.mouse.down();
    await expect(source).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('file-editor').locator('.folder-path')).toContainText(middle);
    await expect(page.locator('[data-reorder-preview]')).toHaveCount(0);
    const neighborName = direction === 'left' ? paths[0]! : paths[2]!;
    const neighbor = strip.getByRole('tab', { name: neighborName, exact: true });
    const neighborRow = await neighbor.evaluate(element => {
      const bounds = element.closest('.folder-tab')!.getBoundingClientRect(); return { x: bounds.x, width: bounds.width };
    });
    const offset = grabX - sourceRow.x;
    const destination = neighborRow.x + neighborRow.width / 2 + (direction === 'left' ? -4 : 4 - sourceRow.width) + offset;
    await page.mouse.move(grabX + (direction === 'left' ? -8 : 8), y, { steps: 2 });
    const preview = page.locator('[data-reorder-preview="item"]');
    await expect(preview).toHaveCount(1);
    await expect(preview.locator('.folder-tab')).toHaveAttribute('data-active', 'true');
    await page.mouse.move(destination, y, { steps: 6 });
    const neighborX = () => neighbor.evaluate(element => element.closest('.folder-tab')!.getBoundingClientRect().x);
    const shiftedX = neighborRow.x + (direction === 'left' ? sourceRow.width : -sourceRow.width);
    await expect.poll(neighborX).toBeCloseTo(shiftedX, 1);
    await page.mouse.move(grabX, y, { steps: 6 });
    await expect.poll(neighborX).toBeCloseTo(neighborRow.x, 1);
    await page.mouse.move(destination, y, { steps: 6 });
    await expect.poll(neighborX).toBeCloseTo(shiftedX, 1);
    await page.screenshot({ path: info.outputPath(`half-overlap-${direction}.png`) });
    await page.mouse.up();
    await expect(strip.getByRole('tab').nth(direction === 'left' ? 0 : 2)).toContainText('document-with-a-much-longer-name');
    await expect(source).toHaveAttribute('aria-selected', 'true');
    await expect(preview).toHaveCount(0);
  });
}

test('moving the selected document backward never detaches or reloads its editor', async ({ page }) => {
  await openWorking(page); await openWorking(page, 'new file.ts', 'untracked');
  const strip = page.getByRole('tablist', { name: '已打开的文件与比较' });
  await strip.getByRole('tab').first().click();
  await replaceText(page, 'unsaved draft survives tab reordering');
  const continuity = await page.getByTestId('file-editor').evaluateHandle(async element => {
    const path = '/src/ui/code/runtime.ts';
    const { editorApi } = await import(path) as typeof import('../src/ui/code/runtime');
    const state = { detached: 0, reads: 0 };
    const observer = new MutationObserver(records => {
      for (const record of records) for (const node of record.removedNodes) if (node === element) state.detached += 1;
    });
    observer.observe(element.parentElement!, { childList: true });
    const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, ...args: unknown[]) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const invoke = internals.invoke;
    internals.invoke = new Proxy(invoke, { apply(target, receiver, args: unknown[]) {
      if (args[0] === 'editor_read_file') state.reads += 1;
      return Reflect.apply(target, receiver, args);
    } });
    return { state, observer, internals, invoke, editorApi, models: editorApi.editor.getModels(), views: editorApi.editor.getEditors() };
  });
  const source = (await strip.getByRole('tab').first().boundingBox())!;
  const target = (await strip.getByRole('tab').nth(1).boundingBox())!;
  await page.mouse.move(source.x + 20, source.y + source.height / 2); await page.mouse.down();
  await page.mouse.move(target.x + target.width - 8, target.y + target.height / 2, { steps: 12 }); await page.mouse.up();
  await expect(strip.getByRole('tab').last()).toContainText('main.ts');
  await expect(strip.getByRole('tab').last()).toHaveAttribute('aria-selected', 'true');
  const result = await continuity.evaluate(async snapshot => {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    snapshot.observer.disconnect(); snapshot.internals.invoke = snapshot.invoke;
    const models = snapshot.editorApi.editor.getModels(); const views = snapshot.editorApi.editor.getEditors();
    return { ...snapshot.state, sameModels: models.length === snapshot.models.length && snapshot.models.every(model => models.includes(model)),
      sameViews: views.length === snapshot.views.length && snapshot.views.every(view => views.includes(view)) };
  });
  await continuity.dispose();
  expect(result).toEqual({ detached: 0, reads: 0, sameModels: true, sameViews: true });
  await expect(page.getByTestId('file-editor').locator('.view-lines')).toContainText('unsaved draft survives tab reordering');
  await page.getByTestId('file-editor').locator('textarea.inputarea').focus(); await page.keyboard.press('Control+z');
  await expect(page.getByTestId('file-editor').locator('.view-lines')).not.toContainText('unsaved draft survives tab reordering');
});

for (const width of [1240, 760]) {
  test(`dragging file tabs scrolls both strip edges with a stationary pointer at width ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 800 });
    const paths = Array.from({ length: 6 }, (_, index) => `src/drag-scroll-document-${index}-with-long-name.ts`);
    await page.evaluate(paths => localStorage.setItem('mock-git-snapshot', JSON.stringify({
      root: '/home/e2e/project', branch: 'main', entries: paths.map(path => ({ path, previousPath: null, indexStatus: ' ', worktreeStatus: 'M' })),
    })), paths);
    await page.getByRole('button', { name: '刷新变更' }).click();
    for (const path of paths) await openWorking(page, path);
    await openWorking(page, paths[0]);
    const strip = page.getByRole('tablist', { name: '已打开的文件与比较' });
    const bounds = (await strip.boundingBox())!;
    const source = (await strip.getByRole('tab').first().boundingBox())!;
    const row = (await strip.locator('.folder-tab').first().boundingBox())!;
    const y = source.y + source.height / 2; const offset = source.x + 20 - row.x;
    await page.mouse.move(source.x + 20, y); await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width - 4, y, { steps: 8 });
    const initial = await strip.evaluate(element => element.scrollLeft);
    await expect.poll(() => strip.evaluate(element => element.scrollLeft)).toBeGreaterThan(initial + 80);
    const progress = await strip.evaluate(element => element.scrollLeft);
    await expect.poll(() => strip.evaluate(element => element.scrollLeft)).toBeGreaterThan(progress + 80);
    await page.mouse.move(bounds.x + (bounds.width - row.width) / 2 + offset, y, { steps: 4 });
    const drift = await strip.evaluate(async element => {
      const start = element.scrollLeft;
      for (let frame = 0; frame < 12; frame++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      return element.scrollLeft - start;
    });
    expect(Math.abs(drift)).toBeLessThan(1);
    await page.mouse.move(bounds.x + bounds.width - 4, y, { steps: 4 });
    await expect.poll(() => strip.evaluate(element => element.scrollWidth - element.clientWidth - element.scrollLeft)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath(`drag-scroll-right-${width}.png`) });
    await page.mouse.up();
    await expect(strip.getByRole('tab').last()).toContainText('drag-scroll-document-0');
    await expect(strip.getByRole('tab').last()).toHaveAttribute('aria-selected', 'true');
    const last = (await strip.getByRole('tab').last().boundingBox())!;
    await page.mouse.move(last.x + 20, y); await page.mouse.down();
    await page.mouse.move(bounds.x + 4, y, { steps: 8 });
    const end = await strip.evaluate(element => element.scrollLeft);
    await expect.poll(() => strip.evaluate(element => element.scrollLeft)).toBeLessThan(end - 80);
    await expect.poll(() => strip.evaluate(element => element.scrollLeft)).toBe(0);
    await page.screenshot({ path: info.outputPath(`drag-scroll-left-${width}.png`) });
    await page.mouse.up();
    await expect(strip.getByRole('tab').first()).toContainText('drag-scroll-document-0');
    await expect(strip.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
    await expect(strip.getByRole('tab')).toHaveCount(paths.length);
  });
}
