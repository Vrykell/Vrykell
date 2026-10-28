import { expect, test, type Page } from '@playwright/test';
import { setupTauriMock, waitForWorkbench } from './tauri-mock';
import { openWorkspaceResource } from './workbench';
import { pickPlacementZone } from './placement';

test.setTimeout(60_000);

async function splitChoice(page: Page, name: string) {
  const bar = page.getByTestId('workspace-instance-bar');
  await bar.locator('.folder-tab[data-active="true"]').first().click({ button: 'right' });
  await page.getByRole('menu', { name: '标签页操作' }).getByText('拆分标签页', { exact: true }).hover();
  await page.getByRole('menu', { name: '拆分标签页', exact: true }).getByText(name, { exact: true }).click();
}

for (const area of ['terminal', 'code', 'ai', 'unified'] as const) {
  test(`uses one leading resource switcher and typed split menus in ${area}`, async ({ page }, info) => {
    await setupTauriMock(page, {}); await page.goto('/'); await waitForWorkbench(page);
    await page.getByTestId(`workspace-area-${area}`).click();
    if (area === 'code') {
      await page.getByTestId('code-start-page-content').getByRole('button', { name: '新建文件', exact: true }).click();
      await expect(page.getByTestId('file-editor').locator('.monaco-editor')).toBeVisible();
    } else if (area === 'ai') {
      await expect(page.locator('[data-tab-kind="start-ai"]')).toBeVisible();
      await page.getByTestId('ai-new-conversation').click();
      await expect(page.locator('[data-chat-composer]:visible')).toBeVisible();
    } else if (area === 'unified') await openWorkspaceResource(page);
    const bar = page.getByTestId('workspace-instance-bar');
    await expect(bar.locator('.folder-more').getByTestId('workspace-resource-switcher')).toBeVisible();
    await expect(bar.locator('.folder-actions').getByTestId('workspace-resource-switcher')).toHaveCount(0);
    await expect(bar.getByRole('button', { name: '拆分标签页', exact: true })).toHaveCount(0);
    await expect(bar.getByRole('button', { name: '选择项目文件夹', exact: true })).toHaveCount(0);
    await expect(bar.getByRole('button', { name: '在终端中打开', exact: true })).toHaveCount(0);
    await splitChoice(page, area === 'terminal' ? '新终端' : area === 'ai' ? '新对话' : '新建文件');
    if (area === 'terminal') {
      const picker = page.getByRole('dialog', { name: '新建标签页' });
      await expect(picker.getByTestId('new-tab-option-ssh:ssh-1')).toHaveCount(0);
      await picker.getByTestId('new-tab-option-shell:bash').click();
    }
    await expect(page.getByTestId('placement-overlay')).toBeVisible();
    const pane = page.locator(area === 'terminal' ? '.terminal-pane:visible' : '.unified-pane:visible').first();
    await pickPlacementZone(page, pane, 'right');
    await expect(page.locator(area === 'terminal' ? '.terminal-pane:visible' : '.unified-pane:visible')).toHaveCount(2);
    for (const width of [1240, 760]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(bar.getByRole('button', { name: '全部工作区标签', exact: true })).toBeInViewport();
      await page.screenshot({ path: info.outputPath(`${area}-${width}.png`), animations: 'disabled' });
    }
  });
}

test('docks the focused common-workspace conversation without losing its draft or terminal sibling', async ({ page }) => {
  await setupTauriMock(page, {}); await page.goto('/'); await waitForWorkbench(page);
  await page.evaluate(async () => {
    const { useChatStore } = await import('/src/features/chat/stores/chat.ts');
    const { useAiWorkspace } = await import('/src/features/chat/stores/aiWorkspace.ts');
    const { useUnifiedWorkspace } = await import('/src/features/workspace/stores/unifiedWorkspace.ts');
    const { useWorkspaceNavigation } = await import('/src/features/workspace/stores/navigation.ts');
    const id = useChatStore.getState().createConversation(); useAiWorkspace.getState().openNative(id);
    useUnifiedWorkspace.getState().restore({ type: 'split', direction: 'row', ratio: 0.5,
      first: { type: 'pane', id: 'terminal', resourceId: 'terminal:t1#0' }, second: { type: 'pane', id: 'chat', resourceId: `chat:${id}` } }, 'chat');
    useWorkspaceNavigation.getState().selectArea('unified');
  });
  const composer = page.locator('[data-chat-composer]:visible');
  await composer.fill('Keep this draft');
  await page.getByTestId('workspace-instance-bar').getByRole('button', { name: '将 AI 停靠到侧栏', exact: true }).click();
  await expect(page.getByTestId('ai-sidebar-content').locator('[data-chat-composer]')).toHaveValue('Keep this draft');
  await expect(page.locator('.unified-pane:visible .terminal-pane')).toHaveCount(1);
});

test('restores saved owners without reopening leftover database sessions', async ({ page }) => {
  await setupTauriMock(page, {});
  await page.addInitScript(() => {
    localStorage.setItem('workspace-containers-v2', JSON.stringify({ version: 2,
      tabs: [{ id: 't1', scope: 'terminal', layout: { type: 'pane', id: 't1#0', resourceId: 'terminal:t1#0' }, focused: 't1#0' }], groups: [], selected: { terminal: 't1' }, order: {} }));
    const host = window as unknown as { __ARCHIVED__: string[]; __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } };
    host.__ARCHIVED__ = [];
    const original = host.__TAURI_INTERNALS__.invoke;
    host.__TAURI_INTERNALS__.invoke = async (command, args) => {
      const result = await original(command, args);
      if (command === 'archive_session') host.__ARCHIVED__.push(String(args?.id));
      if (command === 'list_sessions') return [...result as object[], { id: 'leftover', title: 'Old session', kind: 'session', status: 'active', sort_order: 1 }];
      return result;
    };
  });
  await page.goto('/'); await waitForWorkbench(page);
  await expect(page.locator('[data-tab-kind="session"]')).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as { __ARCHIVED__: string[] }).__ARCHIVED__)).toContain('leftover');
});
