import { expect, test, type Page } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';
import { pickPlacementZone } from './placement';

async function openFirstResource(page: Page) {
  await page.getByTestId('workspace-instance-bar').getByTestId('workspace-resource-switcher').click();
  await page.getByRole('menu', { name: '全部工作区标签' }).getByRole('menuitem').first().click();
}

test('opens a file with the terminal preference in its own unified tab', async ({ page }) => {
  await setupTauriMock(page, {});
  await page.addInitScript(() => {
    localStorage.setItem('vrykell-editor-preferences', JSON.stringify({ state: { localOpenMode: 'terminal' }, version: 0 }));
  });
  await page.goto('/');
  await page.getByTestId('workspace-area-unified').click();
  const mixed = page.getByTestId('unified-workspace');
  const bar = page.getByTestId('workspace-instance-bar');
  await openFirstResource(page);
  const before = await bar.getByRole('tab').count();
  await page.locator('[data-dock-btn="files"]').click();
  await page.getByTestId('local-file-tree').getByText('notes.txt', { exact: true }).dblclick();
  await expect(page.getByTestId('workspace-area-unified')).toHaveAttribute('aria-current', 'page');
  await expect(bar.getByRole('tab')).toHaveCount(before + 1);
  await expect(mixed.locator('.unified-pane')).toHaveCount(1);
  await expect(mixed.locator('.terminal-pane:visible')).toHaveCount(1);
});

test('opens a picked file in a separate unified tab and reuses it when reopened', async ({ page }) => {
  await setupTauriMock(page, {}); await page.goto('/');
  await page.getByTestId('workspace-area-unified').click();
  const mixed = page.getByTestId('unified-workspace');
  const bar = page.getByTestId('workspace-instance-bar');
  await openFirstResource(page);
  const before = await bar.getByRole('tab').count();
  await page.evaluate(() => { (window as unknown as { __PICK_PATHS__: string[] }).__PICK_PATHS__ = ['/home/e2e/project/routed.txt']; });
  await bar.getByRole('button', { name: '打开文件', exact: true }).click();
  await expect(page.getByTestId('workspace-area-unified')).toHaveAttribute('aria-current', 'page');
  await expect(bar.getByRole('tab')).toHaveCount(before + 1);
  await expect(mixed.locator('.unified-pane')).toHaveCount(1);
  await expect(mixed.locator('.monaco-editor')).toBeVisible();
  await page.evaluate(() => { (window as unknown as { __PICK_PATHS__: string[] }).__PICK_PATHS__ = ['/home/e2e/project/routed.txt']; });
  await bar.getByRole('button', { name: '打开文件', exact: true }).click();
  await expect(bar.getByRole('tab')).toHaveCount(before + 1);
});

test('opens the split-resource menu when splitting a terminal in the unified workspace', async ({ page }) => {
  await setupTauriMock(page, {}); await page.goto('/');
  await expect(page.locator('.terminal-pane').first()).toBeVisible();
  await page.getByTestId('workspace-area-unified').click();
  const mixed = page.getByTestId('unified-workspace');
  const bar = page.getByTestId('workspace-instance-bar');
  await openFirstResource(page);
  const terminal = mixed.locator('.terminal-pane:visible').first();
  await expect(terminal).toBeVisible();
  await terminal.click({ button: 'right' });
  await page.getByRole('menu', { name: '操作菜单', exact: true }).getByRole('button', { name: '拆分标签页', exact: true }).click();
  const chooser = page.getByRole('menu', { name: '选择分屏标签', exact: true });
  await expect(chooser).toBeVisible();
  await expect(chooser).toContainText('新终端');
  await expect(page.getByTestId('placement-overlay')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await bar.getByRole('button', { name: '拆分标签页', exact: true }).click();
  await page.getByRole('menuitem', { name: '新建文件', exact: true }).click();
  await pickPlacementZone(page, mixed.locator('.unified-pane').first(), 'right');
  const terminalPane = mixed.locator('.unified-pane').filter({ has: page.locator('.terminal-pane') });
  const filePane = mixed.locator('.unified-pane').filter({ has: page.locator('.monaco-editor') });
  await expect(filePane).toBeVisible();
  await terminalPane.locator('.terminal-pane').click({ button: 'right' });
  await page.getByRole('button', { name: '更换窗格位置', exact: true }).click();
  await expect(page.getByTestId('placement-overlay')).toBeVisible();
  await pickPlacementZone(page, filePane, 'bottom');
  const terminalBounds = (await terminalPane.boundingBox())!;
  const fileBounds = (await filePane.boundingBox())!;
  expect(terminalBounds.y).toBeGreaterThan(fileBounds.y);
});

test('creates directly into a split and preserves the initial live resource', async ({ page }, info) => {
  await setupTauriMock(page, {}); await page.goto('/');
  const terminal = await page.locator('.terminal-pane').first().elementHandle();
  await page.getByTestId('workspace-area-unified').click();
  const mixed = page.getByTestId('unified-workspace'); const bar = page.getByTestId('workspace-instance-bar');
  await openFirstResource(page);
  await expect(mixed.getByTestId('unified-start-page')).toHaveCount(0);
  await bar.getByRole('tab').nth(0).click();
  await bar.getByRole('button', { name: '拆分标签页' }).click();
  await page.getByRole('menuitem', { name: '新建文件', exact: true }).click();
  await expect(mixed.locator('.unified-pane')).toHaveCount(1);
  await pickPlacementZone(page, mixed.locator('.unified-pane').first(), 'right');
  await expect(mixed.locator('.unified-pane')).toHaveCount(2);
  await expect(mixed.locator('.monaco-editor')).toBeVisible();
  await bar.getByRole('button', { name: '拆分标签页' }).click();
  await page.getByRole('menuitem', { name: '新对话', exact: true }).click();
  await pickPlacementZone(page, mixed.locator('.unified-pane').filter({ has: page.locator('.monaco-editor') }), 'bottom');
  await expect(mixed.locator('.unified-pane')).toHaveCount(3);
  await mixed.locator('[data-chat-composer]').fill('new split draft');
  expect(await terminal!.evaluate(element => element.isConnected && !!element.closest('[data-testid="unified-workspace"]'))).toBe(true);
  for (const width of [1240, 760]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(mixed.locator('[data-chat-composer]')).toHaveValue('new split draft');
    await page.screenshot({ path: info.outputPath(`create-mixed-split-${width}.png`) });
  }
});

test('shares mixed tabs and split panes without restarting terminals or discarding editor and conversation drafts', async ({ page }, info) => {
  await setupTauriMock(page, {});
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  const terminal = page.locator('.terminal-pane').first(); const terminalNode = await terminal.elementHandle();
  const terminalTitle = await page.getByTestId('workspace-instance-bar').getByRole('tab').first().innerText();
  const spawns = await page.evaluate(() => (window as unknown as { __PTY_SPAWNS__: unknown[] }).__PTY_SPAWNS__.length);
  await page.getByTestId('workspace-area-code').click();
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: '新建文件', exact: true }).click();
  const file = page.getByTestId('file-editor');
  await expect(file.locator('.monaco-editor')).toBeVisible();
  await file.locator('textarea.inputarea').focus(); await page.keyboard.insertText('mixed editor draft');
  const editorNode = await file.locator('.monaco-editor').elementHandle();
  await page.getByTestId('workspace-area-ai').click();
  await page.getByTestId('ai-new-conversation').click();
  await page.locator('.ai-chat-panel:visible [data-chat-composer]').fill('first conversation draft');
  await page.getByTestId('ai-new-conversation').click();
  await page.locator('.ai-chat-panel:visible [data-chat-composer]').fill('second conversation draft');
  await page.getByTestId('workspace-instance-bar').getByTestId('workspace-resource-switcher').click();
  await expect(page.getByRole('menuitem', { name: '聚合工作区', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByTestId('workspace-area-unified').click();
  const mixed = page.getByTestId('unified-workspace');
  const strip = page.getByTestId('workspace-instance-bar').getByRole('tablist', { name: '全部工作区标签' });
  await page.getByTestId('workspace-instance-bar').getByTestId('workspace-resource-switcher').click();
  await page.getByRole('menuitem', { name: '未命名 1.txt', exact: true }).click();
  await expect(strip.getByRole('tab')).toHaveCount(1);
  await strip.getByRole('tab', { name: /未命名 1.txt/ }).click();
  await expect(mixed.locator('.view-lines')).toContainText('mixed editor draft');
  expect(await editorNode!.evaluate(element => element.isConnected && !!element.closest('[data-testid="unified-workspace"]'))).toBe(true);
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: '拆分标签页' }).click();
  await page.getByRole('menuitem', { name: terminalTitle, exact: true }).click();
  await pickPlacementZone(page, mixed.locator('.unified-pane').first(), 'right');
  await expect(mixed.locator('.unified-pane')).toHaveCount(2);
  expect(await terminalNode!.evaluate(element => element.isConnected && !!element.closest('[data-testid="unified-workspace"]'))).toBe(true);
  await mixed.getByPlaceholder(/输入命令/).fill('echo keep-terminal');
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: '拆分标签页' }).click();
  await page.getByRole('menuitem', { name: '新对话', exact: true }).first().click();
  await pickPlacementZone(page, mixed.locator('.unified-pane').filter({ has: page.locator('.monaco-editor') }), 'bottom');
  await expect(mixed.locator('.unified-pane')).toHaveCount(3);
  await expect(mixed.locator('[data-chat-composer]')).toHaveValue('first conversation draft');
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: '拆分标签页' }).click();
  await page.getByRole('menuitem', { name: '新对话', exact: true }).click();
  await pickPlacementZone(page, mixed.locator('.unified-pane').filter({ has: page.locator('.terminal-pane') }), 'bottom');
  await expect(mixed.locator('.unified-pane')).toHaveCount(4);
  const drafts = mixed.locator('[data-chat-composer]');
  expect(await drafts.evaluateAll(inputs => inputs.map(input => (input as HTMLTextAreaElement).value).sort())).toEqual(['first conversation draft', 'second conversation draft']);
  const divider = mixed.getByRole('separator', { name: '调整工作区分屏大小' }).first();
  const ratio = Number(await divider.getAttribute('aria-valuenow')); await divider.focus(); await page.keyboard.press('ArrowRight');
  await expect(divider).not.toHaveAttribute('aria-valuenow', String(ratio));
  for (const width of [1240, 760]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(mixed.locator('.unified-pane')).toHaveCount(4);
    await page.screenshot({ path: info.outputPath(`mixed-workspace-${width}.png`) });
  }
  await page.setViewportSize({ width: 1240, height: 800 });
  await mixed.locator('.unified-pane').filter({ has: page.locator('.monaco-editor') }).locator('textarea.inputarea').focus();
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: '工作区操作' }).click();
  await page.getByRole('menu').locator('button').filter({ hasText: '移除此分屏' }).click();
  const confirm = page.getByRole('dialog', { name: '未保存的更改' }); await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: '取消', exact: true }).click();
  await expect(mixed.locator('.unified-pane')).toHaveCount(4);
  await expect(mixed.locator('.view-lines')).toContainText('mixed editor draft');
  await page.getByTestId('workspace-sidebar-expand').click();
  await page.getByTestId('workspace-area-terminal').click();
  await expect(page.getByPlaceholder(/输入命令/)).toHaveValue('echo keep-terminal');
  expect(await terminalNode!.evaluate(element => element.isConnected)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __PTY_SPAWNS__: unknown[] }).__PTY_SPAWNS__.length)).toBe(spawns);
  expect(await page.evaluate(() => (window as unknown as { __PTY_CLOSES__: unknown[] }).__PTY_CLOSES__.length)).toBe(0);
});

test('opens or selects resource tabs from the unified switcher and keeps native navigation', async ({ page }) => {
  await setupTauriMock(page, {});
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await page.evaluate(async () => {
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    useWorkspaceStore.getState().renameTab(useWorkspaceStore.getState().activeId, 'Stable shell');
    useWorkspaceStore.getState().openEditorFile({ path: '/home/e2e/project/notes.txt' });
  });
  await page.getByTestId('workspace-area-terminal').click();

  // A regular workspace keeps navigating to the resource's native pane.
  await page.getByTestId('workspace-instance-bar').getByTestId('workspace-resource-switcher').click();
  await page.getByRole('menuitem', { name: 'notes.txt', exact: true }).click();
  await expect(page.getByTestId('workspace-area-code')).toHaveAttribute('aria-current', 'page');

  // The common workspace opens an independent tab without an implicit split.
  await page.getByTestId('workspace-area-unified').click();
  const mixed = page.getByTestId('unified-workspace');
  const bar = page.getByTestId('workspace-instance-bar');
  await openFirstResource(page);
  await expect(mixed.locator('.unified-pane')).toHaveCount(1);
  await bar.getByTestId('workspace-resource-switcher').click();
  await page.getByRole('menuitem', { name: 'notes.txt', exact: true }).click();
  await expect(mixed.locator('.unified-pane')).toHaveCount(1);
  await expect(bar.getByRole('tab')).toHaveCount(2);
  await expect(page.getByTestId('workspace-area-unified')).toHaveAttribute('aria-current', 'page');
});
