import { test, expect } from '@playwright/test';
import { setupTauriMock, acpCalls } from './tauri-mock';

test.beforeEach(async ({ page }) => {
  await setupTauriMock(page, { schedulesSeed: [], terminalDirectories: true });
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
});

test('uses a full-height sidebar and keeps terminals alive across empty workspaces', async ({ page }, info) => {
  const terminal = await page.locator('[data-tab-row-id]').first().getAttribute('data-tab-row-id');
  const rail = page.getByTestId('workspace-sidebar');
  expect(await rail.boundingBox()).toMatchObject({ x: 0, y: 0, width: 208, height: 800 });
  expect((await page.locator('.workspace-titlebar').boundingBox())!.x).toBe(208);
  expect((await page.getByTestId('workspace-instance-bar').boundingBox())!.y).toBe(42);
  await page.getByTestId('workspace-area-code').click();
  await expect(page.getByTestId('code-start-page')).toBeVisible();
  await page.getByTestId('workspace-area-ssh').click();
  await expect(page.getByTestId('ssh-workspace')).toBeVisible();
  await page.getByTestId('workspace-area-terminal').click();
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await expect(page.locator(`[data-tab-row-id="${terminal}"]`)).toHaveAttribute('data-active', 'true');
  await page.screenshot({ path: info.outputPath('workspace-wide.png') });
  await page.getByTestId('workspace-sidebar-toggle').click();
  await expect(rail).toBeHidden();
  expect(await rail.evaluate(element => element.getBoundingClientRect().width)).toBe(0);
  const expand = page.getByTestId('workspace-sidebar-expand');
  await expect(expand).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expand.hover();
  await expand.evaluate(async element => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await Promise.all(element.getAnimations().map(animation => animation.finished));
  });
  await expect(expand).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expand.click();
  await page.setViewportSize({ width: 760, height: 800 });
  await expect(rail).toHaveAttribute('data-collapsed', 'true');
  await expect(rail).toBeHidden();
  expect(await rail.evaluate(element => element.getBoundingClientRect().width)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(760);
  await page.screenshot({ path: info.outputPath('workspace-narrow.png') });
  await expand.click();
  await expect(rail).toBeVisible();
  expect((await rail.boundingBox())!.width).toBe(208);
});

test('moves the same native conversation and composer between main and side', async ({ page }, info) => {
  await page.getByTestId('workspace-area-ai').click();
  await page.getByTestId('ai-new-conversation').click();
  const composer = page.locator('[data-chat-composer]:visible');
  await composer.fill('keep this draft');
  await composer.evaluate(element => { (window as unknown as { savedComposer: Element }).savedComposer = element; });
  await page.getByTestId('ai-relocate').click();
  await expect(page.locator('.workspace-side-panel[data-side="right"]')).toBeVisible();
  await expect(composer).toHaveValue('keep this draft');
  expect(await composer.evaluate(element => element === (window as unknown as { savedComposer: Element }).savedComposer)).toBe(true);
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await expect(page.getByTestId('ai-surface-side').getByRole('tablist')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('workspace-ai-side.png') });
  await page.getByTestId('ai-return-to-workspace').click();
  await expect(page.getByTestId('workspace-area-ai')).toHaveAttribute('aria-current', 'page');
  await expect(composer).toHaveValue('keep this draft');
  expect(await composer.evaluate(element => element === (window as unknown as { savedComposer: Element }).savedComposer)).toBe(true);
  await expect(page.locator('.workspace-side-panel:visible')).toHaveCount(0);
});

test('keeps native and connected sessions in one AI strip without closing either on navigation', async ({ page }) => {
  await page.getByTestId('workspace-area-ai').click();
  await page.getByTestId('ai-new-conversation').click();
  await page.locator('[data-chat-composer]:visible').fill('native draft');
  await page.getByTestId('harness-add-session').click();
  await page.getByTestId('acp-launcher-Fake ACP').click();
  await expect(page.getByTestId('harness-composer')).toBeVisible();
  await page.getByTestId('harness-composer').fill('agent draft');
  const strip = page.getByTestId('workspace-instance-bar');
  await expect(strip.getByRole('tab')).toHaveCount(2);
  await strip.getByRole('tab', { name: '新对话', exact: true }).click();
  await expect(page.locator('[data-chat-composer]:visible')).toHaveValue('native draft');
  await strip.getByRole('tab', { name: 'Fake ACP', exact: true }).click();
  await expect(page.getByTestId('harness-composer')).toHaveValue('agent draft');
  await page.getByTestId('workspace-area-terminal').click();
  expect((await acpCalls(page)).filter(call => call.startsWith('acp_close:'))).toHaveLength(0);
  await page.getByTestId('workspace-area-ai').click();
  await expect(page.getByTestId('harness-composer')).toHaveValue('agent draft');
  await page.locator('[data-dock-btn="chat"]').click();
  await expect(page.getByTestId('harness-composer')).toHaveValue('agent draft');
  const side = page.getByTestId('ai-surface-side');
  await expect(side.locator('[data-chat-composer]')).toHaveValue('native draft');
  await expect(side.getByRole('tablist')).toHaveCount(0);
  await expect(side.getByTestId('harness-composer')).toHaveCount(0);
});

test('collapses colored terminal groups while preserving the active session and actions', async ({ page }, info) => {
  const id = await page.evaluate(async () => {
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    const state = useWorkspaceStore.getState();
    const active = state.tabs.find(tab => tab.id === state.activeId)!;
    if (active.kind !== 'session') throw new Error('Expected terminal session');
    useWorkspaceStore.setState({ groups: [{ id: 'work', title: 'Work', collapsed: false }], tabs: state.tabs.map(tab => tab.id === active.id ? { ...active, groupId: 'work' } : tab) });
    return active.id;
  });
  const group = page.getByTestId('group-header-work');
  await group.click();
  await expect(group).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator(`[data-tab-row-id="${id}"]`)).toHaveCount(0);
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await group.click({ button: 'right' });
  await page.getByRole('menuitemradio', { name: '紫色', exact: true }).click();
  await expect(page.locator('.terminal-tab-group')).toHaveAttribute('data-group-color', 'violet');
  await group.click();
  await expect(page.locator(`[data-tab-row-id="${id}"]`)).toBeVisible();
  await page.screenshot({ path: info.outputPath('workspace-groups.png') });
});

test('routes every auxiliary panel to the right and keeps the workspace full height', async ({ page }) => {
  for (const panel of ['files', 'git', 'command-history', 'chat']) {
    await page.locator(`[data-dock-btn="${panel}"]`).click();
    const visible = page.locator('.workspace-side-panel:visible');
    await expect(visible).toHaveCount(1);
    await expect(visible).toHaveAttribute('data-side', 'right');
    expect((await visible.boundingBox())!.y).toBe(42);
    expect((await visible.boundingBox())!.height).toBe(758);
    const strip = (await page.getByTestId('workspace-instance-bar').boundingBox())!;
    expect(strip.x + strip.width).toBeCloseTo((await visible.boundingBox())!.x, 0);
  }
  await page.getByTestId('workspace-settings').click();
  await expect(page.locator('.settings-screen')).toBeVisible();
  expect((await page.getByTestId('workspace-sidebar').boundingBox())!.height).toBe(800);
});

test('new, close and numeric shortcuts follow the workspace and the focused side conversation', async ({ page }) => {
  await page.evaluate(async () => {
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    useWorkspaceStore.getState().openEditorFile({ path: '/home/e2e/project/first.ts' });
    (window as unknown as { __PICK_PATHS__: string[] }).__PICK_PATHS__ = ['/home/e2e/project/second.ts'];
  });
  await page.keyboard.press('Control+t');
  const strip = page.getByTestId('workspace-instance-bar');
  await expect(strip.getByRole('tab')).toHaveCount(2);
  await page.keyboard.press('Control+1');
  await expect(strip.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Control+w'); await page.keyboard.press('Control+w');
  await expect(page.getByTestId('code-start-page')).toBeVisible();
  await page.getByTestId('workspace-area-terminal').click();
  await page.keyboard.press('Control+t');
  await expect(strip.locator('[data-tab-kind="session"]')).toHaveCount(2);
  await page.getByTestId('workspace-area-ai').click();
  await page.keyboard.press('Control+t');
  await expect(page.locator('[data-chat-composer]:visible')).toBeVisible();
  await page.getByTestId('ai-relocate').click();
  const composer = page.locator('[data-chat-composer]:visible');
  await composer.focus(); await page.keyboard.press('Control+t');
  await expect(page.locator('[data-testid="ai-surface-side"] [role="tab"]')).toHaveCount(0);
  await expect(strip.locator('[data-tab-kind="session"]')).toHaveCount(2);
  await composer.fill('keep the second draft');
  await page.keyboard.press('Control+1'); await expect(composer).toHaveValue('');
  await page.keyboard.press('Control+2'); await expect(composer).toHaveValue('keep the second draft');
  await page.keyboard.press('Control+w');
  await expect(page.getByTestId('ai-surface-side')).toBeHidden();
  await expect(strip.locator('[data-tab-kind="session"]')).toHaveCount(2);
});
