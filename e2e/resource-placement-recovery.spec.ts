import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test('restores a mixed workspace and switches retained content owners without a render loop', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /Maximum update depth|ErrorBoundary/.test(message.text())) errors.push(message.text()); });
  await setupTauriMock(page);
  await page.goto('/'); await expect(page.locator('[data-terminal-input]')).toBeVisible();
  const nativeInput = page.locator('[data-terminal-input]:visible');
  await nativeInput.click();
  await page.keyboard.type('echo native-input');
  await expect(nativeInput).toHaveValue('echo native-input');
  await page.keyboard.press('Enter');
  await expect(page.locator('.command-block-command').filter({ hasText: 'echo native-input' })).toBeVisible();
  await page.evaluate(async () => {
    const nativePath = '/src/features/workspace/stores/workspace.ts';
    const actionsPath = '/src/features/workspace/services/unifiedWorkspace.ts';
    const areaPath = '/src/features/workspace/stores/unifiedWorkspace.ts';
    const resourcesPath = '/src/features/workspace/services/workspaceResources.ts';
    const { useWorkspaceStore } = await import(nativePath) as typeof import('../src/features/workspace/stores/workspace');
    const { focusUnifiedResource } = await import(actionsPath) as typeof import('../src/features/workspace/services/unifiedWorkspace');
    const { useUnifiedWorkspace } = await import(areaPath) as typeof import('../src/features/workspace/stores/unifiedWorkspace');
    const { currentWorkspaceResources } = await import(resourcesPath) as typeof import('../src/features/workspace/services/workspaceResources');
    useWorkspaceStore.getState().openEditorFile({ path: '/home/e2e/project/src/main.ts' });
    const resources = currentWorkspaceResources();
    const terminal = resources.find(item => item.kind === 'terminal')!;
    const document = resources.find(item => item.kind === 'document')!;
    focusUnifiedResource(terminal.id);
    useUnifiedWorkspace.getState().split(document.id, 'row');
  });
  const workspace = page.getByTestId('unified-workspace');
  await expect(workspace.locator('.unified-pane')).toHaveCount(2);
  for (let round = 0; round < 8; round++) {
    for (const scope of ['terminal', 'code', 'unified']) await page.getByTestId(`workspace-area-${scope}`).click();
    await expect(workspace.locator('.unified-pane')).toHaveCount(2);
    await expect(workspace.locator('[data-terminal-input]')).toBeVisible();
    await expect(workspace.getByTestId('file-editor')).toBeVisible();
    const input = workspace.locator('[data-terminal-input]');
    await input.click();
    await page.keyboard.type(`echo round-${round}`);
    await expect(input).toHaveValue(`echo round-${round}`);
    await expect(input).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(workspace.locator('.command-block-command').filter({ hasText: `echo round-${round}` })).toBeVisible();
  }
  await page.reload(); await page.getByTestId('workspace-area-unified').click();
  await expect(workspace.locator('.unified-pane')).toHaveCount(2);
  await expect(workspace.locator('[data-terminal-input]')).toBeVisible();
  await expect(workspace.getByTestId('file-editor')).toBeVisible();
  expect(errors).toEqual([]);
});
