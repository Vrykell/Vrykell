import { expect, test } from '@playwright/test';
import { setupTauriMock, waitForWorkbench } from './tauri-mock';
import { gotoSetting } from './settings';

test.setTimeout(60_000);
test.beforeEach(async ({ page }) => {
  await setupTauriMock(page, { launchDirectory: '/home/e2e/project' });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForWorkbench(page);
});

test('keeps a fixed shared rename field, right-pinned actions and one aligned transcript column', async ({ page }, info) => {
  await page.evaluate(async () => {
    const dockPath = '/src/features/workspace/stores/dock.ts';
    const { useDockStore } = await import(dockPath) as typeof import('../src/features/workspace/stores/dock');
    useDockStore.getState().openPanel('chat');
    const chatPath = '/src/features/chat/stores/chat.ts';
    const { useChatStore } = await import(chatPath) as typeof import('../src/features/chat/stores/chat');
    const id = useChatStore.getState().createConversation();
    const workspacePath = '/src/features/chat/stores/aiWorkspace.ts';
    const { useAiWorkspace } = await import(workspacePath) as typeof import('../src/features/chat/stores/aiWorkspace');
    useAiWorkspace.getState().selectSide(`chat:${id}`);
    useChatStore.setState(state => ({ byTab: { ...state.byTab, [id]: [
      { id: 'q', role: 'user', content: 'A short question', createdAt: 1 },
      { id: 'a', role: 'assistant', content: 'A short answer.', createdAt: 2 },
    ] } }));
  });
  const panel = page.getByTestId('ai-sidebar-content');
  await panel.getByRole('button', { name: '重命名对话' }).click();
  const field = panel.getByRole('textbox', { name: '对话标题' });
  await expect(field).toHaveClass(/text-input-field/);
  await field.fill('Short'); const width = (await field.boundingBox())!.width;
  const actions = panel.locator('.chat-conversation-actions'); const first = (await actions.boundingBox())!;
  await field.fill('A much longer name '.repeat(10));
  expect((await field.boundingBox())!.width).toBe(width);
  expect((await actions.boundingBox())!.x).toBe(first.x);
  for (const viewport of [1240, 760]) {
    await page.setViewportSize({ width: viewport, height: 800 });
    const heading = (await panel.locator('.chat-conversation-heading').boundingBox())!;
    const buttons = (await actions.boundingBox())!;
    expect(heading.x + heading.width - buttons.x - buttons.width).toBeLessThanOrEqual(7);
    const exchange = panel.locator('.chat-exchange'); const question = (await exchange.locator('.ai-block-question').boundingBox())!;
    const answer = (await exchange.locator('.ai-block-answer').boundingBox())!;
    expect(question.x + question.width).toBeCloseTo(answer.x + answer.width, 0);
    expect(question.x).toBeGreaterThan(answer.x);
    const send = panel.locator('button.chat-send-button');
    const before = await send.evaluate(element => getComputedStyle(element).backgroundColor);
    await send.hover(); expect(await send.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(before);
    await page.screenshot({ path: info.outputPath(`conversation-${viewport}.png`) });
  }
});

test('loads marketplace presets, exposes recoverable bottom-right errors and uses normal server controls', async ({ page }, info) => {
  await gotoSetting(page, '技能');
  await page.evaluate(() => {
    const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const invoke = runtime.invoke; let failed = false;
    runtime.invoke = (command, args) => {
      if (command === 'market_github_list' && !failed) { failed = true; return Promise.reject(new Error('Network unavailable')); }
      return invoke(command, args);
    };
  });
  await page.getByRole('button', { name: '技能市场', exact: true }).click();
  const alert = page.locator('#app-notifications').getByRole('alert'); await expect(alert).toBeVisible();
  await expect.poll(async () => { const bounds = (await alert.boundingBox())!; return Math.round(bounds.y + bounds.height); }).toBeLessThanOrEqual(784);
  const bounds = (await alert.boundingBox())!; expect(bounds.x + bounds.width).toBeGreaterThan(1200);
  await alert.getByRole('button', { name: '重试' }).click();
  await expect(page.getByText('github-skill-1').first()).toBeVisible();
  await expect(alert).toHaveCount(0);
  const back = page.getByRole('button', { name: '返回', exact: true }); await expect(back.locator('svg')).toHaveCount(1);
  await page.screenshot({ path: info.outputPath('marketplace.png') }); await back.click();
  await page.getByRole('button', { name: 'ACP', exact: true }).click();
  for (const id of ['harness-test-0', 'harness-edit-0', 'harness-remove-0']) {
    const button = page.getByTestId(id); await expect(button).toHaveAttribute('data-compact', 'false');
    expect((await button.boundingBox())!.width).toBeGreaterThanOrEqual(28);
  }
  const remove = page.getByTestId('harness-remove-0'); expect(await remove.evaluate(element => getComputedStyle(element).color)).toBe('rgb(255, 90, 82)');
  await page.screenshot({ path: info.outputPath('normal-server-actions.png') });
});

test('shares close-safe workspace resource navigation and reserves identical leading tab corners', async ({ page }, info) => {
  await page.evaluate(async () => {
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    useWorkspaceStore.getState().renameTab(useWorkspaceStore.getState().activeId, 'Stable shell');
    useWorkspaceStore.getState().openEditorFile({ path: '/home/e2e/project/notes.txt' });
  });
  await page.getByTestId('workspace-instance-bar').getByTestId('workspace-resource-switcher').click();
  const menu = page.getByRole('menu', { name: '全部工作区标签' }); await expect(menu.getByRole('menuitem', { name: 'notes.txt' })).toBeVisible();
  const triggerBounds = (await page.getByTestId('workspace-instance-bar').getByTestId('workspace-resource-switcher').boundingBox())!;
  const menuBounds = (await menu.boundingBox())!;
  expect(menuBounds.x).toBeCloseTo(triggerBounds.x, 0);
  expect(menuBounds.y - triggerBounds.y - triggerBounds.height).toBeCloseTo(4, 0);
  await menu.getByRole('menuitem', { name: 'Stable shell' }).click();
  for (const area of ['terminal', 'code', 'unified', 'ai']) {
    await page.getByTestId(`workspace-area-${area}`).click();
    const bar = page.getByTestId('workspace-instance-bar');
    const more = (await bar.locator('.folder-more').boundingBox())!;
    const first = (await bar.locator('.folder-tab-list .folder-tab').first().boundingBox())!;
    expect(first.x - more.x - more.width).toBeCloseTo(4, 0);
    const track = (await bar.locator('.folder-tab-list').boundingBox())!;
    expect(track.x).toBeGreaterThanOrEqual(more.x + more.width);
    expect(await bar.locator('.folder-more-button').evaluate(element => { const bounds = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)); })).toBe(true);
    await page.screenshot({ path: info.outputPath(`leading-corner-${area}.png`) });
  }
  await page.getByTestId('harness-add-session').click(); await expect(page.getByTestId('acp-launcher-search')).toBeVisible();
  const picker = page.getByRole('dialog', { name: 'ACP', exact: true });
  await expect(picker).toHaveAttribute('aria-modal', 'false'); expect((await picker.boundingBox())!.width).toBeLessThanOrEqual(304);
  await page.screenshot({ path: info.outputPath('acp-profile-dropdown.png') });
  await page.keyboard.press('Escape'); await expect(page.getByTestId('harness-add-session')).toBeFocused();
});
