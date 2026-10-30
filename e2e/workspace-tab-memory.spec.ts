import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
});

for (const width of [1240, 760]) {
  test(`restores each workspace reading tab after mixed resource navigation at ${width}px`, async ({ page }, info) => {
    test.setTimeout(60_000);
    const ids = await page.evaluate(async () => {
      const storePath = '/src/features/workspace/stores/workspace.ts';
      const servicePath = '/src/features/workspace/services/workbench.ts';
      const { useWorkspaceStore } = await import(storePath) as typeof import('../src/features/workspace/stores/workspace');
      const { activateContainer } = await import(servicePath) as typeof import('../src/features/workspace/services/workbench');
      const workspace = useWorkspaceStore.getState();
      const first = workspace.addTab({ title: 'Reading terminal' });
      const second = workspace.addTab({ title: 'Other terminal' });
      activateContainer(first);
      workspace.openEditorFile({ path: '/home/e2e/project/reading.ts' });
      workspace.openEditorFile({ path: '/home/e2e/project/other.ts' });
      return { first, second };
    });
    const strip = page.getByTestId('workspace-instance-bar');
    await strip.getByRole('tab', { name: 'reading.ts', exact: true }).click();
    await page.setViewportSize({ width, height: 800 });
    const navigate = async (area: string) => {
      if (!await page.getByTestId(`workspace-area-${area}`).isVisible()) await page.getByTestId('workspace-sidebar-expand').click();
      await page.getByTestId(`workspace-area-${area}`).click();
    };
    await navigate('unified');
    await page.evaluate(async second => {
      const path = '/src/features/workspace/services/unifiedWorkspace.ts';
      const editorPath = '/src/core/editor.ts';
      const { focusUnifiedResource } = await import(path) as typeof import('../src/features/workspace/services/unifiedWorkspace');
      const { editorFileKey } = await import(editorPath) as typeof import('../src/core/editor');
      focusUnifiedResource(`file:${editorFileKey({ path: '/home/e2e/project/other.ts' })}`);
      focusUnifiedResource(`terminal:${second}#0`);
    }, ids.second);
    await expect(strip.getByRole('tab', { name: 'Other terminal', exact: true })).toHaveAttribute('aria-selected', 'true');
    await navigate('terminal');
    await expect(strip.locator(`[data-tab-row-id="${ids.first}"]`)).toHaveAttribute('data-active', 'true');
    await navigate('code');
    await expect(strip.getByRole('tab', { name: 'reading.ts', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(strip.getByRole('tab')).toHaveCount(2);
    await navigate('unified');
    await expect(strip.getByRole('tab', { name: 'Other terminal', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.screenshot({ path: info.outputPath(`workspace-tab-memory-${width}.png`) });
  });
}

test('returns to the usage tab while conversations remain open', async ({ page }) => {
  await page.getByTestId('workspace-area-ai').click();
  await page.getByTestId('ai-new-conversation').click();
  await page.locator('[data-chat-composer]:visible').fill('Retained conversation draft');
  await page.evaluate(async () => {
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    useWorkspaceStore.getState().openUsageTab();
  });
  const strip = page.getByTestId('workspace-instance-bar');
  const usage = strip.getByRole('tab', { name: '用量统计', exact: true });
  await expect(usage).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('workspace-area-terminal').click();
  await page.getByTestId('workspace-area-ai').click();
  await expect(usage).toHaveAttribute('aria-selected', 'true');
  await strip.getByRole('tab', { name: '新对话', exact: true }).click();
  await expect(page.locator('[data-chat-composer]:visible')).toHaveValue('Retained conversation draft');
});
