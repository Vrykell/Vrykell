import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

for (const direction of ['left', 'right'] as const) test(`unequal terminal tabs exchange by their bounds toward the ${direction}`, async ({ page }, info) => {
  await setupTauriMock(page, { schedulesSeed: [] }); await page.goto('/');
  const ids = await page.evaluate(async () => {
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    useWorkspaceStore.getState().addTab(); useWorkspaceStore.getState().addTab();
    const state = useWorkspaceStore.getState();
    const tabs = state.tabs.filter(tab => tab.kind === 'session');
    const titles = ['A', 'A much longer middle terminal title', 'C'];
    useWorkspaceStore.setState({ tabs: state.tabs.map(tab => ({ ...tab, title: titles[tabs.findIndex(item => item.id === tab.id)] ?? tab.title, titleSource: 'manual' as const })) });
    return tabs.map(tab => tab.id);
  });
  const strip = page.getByTestId('workspace-instance-bar');
  const middle = strip.locator(`[data-tab-row-id="${ids[1]}"]`);
  const neighbor = strip.locator(`[data-tab-row-id="${ids[direction === 'left' ? 0 : 2]}"]`);
  const source = (await middle.boundingBox())!, target = (await neighbor.boundingBox())!;
  expect(source.width).toBeGreaterThan(target.width);
  const grab = direction === 'right' ? 35 : source.width - 35;
  const delta = (target.width / 2 + 12) * (direction === 'right' ? 1 : -1);
  await page.mouse.move(source.x + grab, source.y + 16); await page.mouse.down();
  await page.mouse.move(source.x + grab + delta, source.y + 16, { steps: 8 });
  const preview = page.locator('[data-reorder-preview="item"]');
  await expect(preview).toBeVisible();
  expect((await preview.boundingBox())!.width).toBeCloseTo(source.width, 0);
  await page.screenshot({ path: info.outputPath(`tab-bounds-${direction}.png`), animations: 'disabled' });
  await page.mouse.up();
  expect(await strip.locator('[data-tab-row-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-tab-row-id'))))
    .toEqual(direction === 'right' ? [ids[0], ids[2], ids[1]] : [ids[1], ids[0], ids[2]]);
});

test('group dragging measures the complete neighboring card and carries its members', async ({ page }, info) => {
  await setupTauriMock(page, { schedulesSeed: [] }); await page.goto('/');
  await page.evaluate(async () => {
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = await import(path) as typeof import('../src/features/workspace/stores/workspace');
    useWorkspaceStore.getState().addTab(); useWorkspaceStore.getState().addTab();
    const state = useWorkspaceStore.getState();
    const sessions = state.tabs.filter(tab => tab.kind === 'session');
    const groups = ['a', 'b', 'c'].map(id => ({ id, title: id.toUpperCase(), collapsed: false }));
    useWorkspaceStore.setState({ groups, tabs: state.tabs.map(tab => {
      const index = sessions.findIndex(item => item.id === tab.id);
      return tab.kind === 'session' ? { ...tab, groupId: groups[index]!.id, title: index === 1 ? 'A much longer middle terminal title' : groups[index]!.title, titleSource: 'manual' as const } : tab;
    }) });
  });
  const strip = page.getByTestId('workspace-instance-bar');
  const source = (await strip.locator('[data-group-id="b"]').boundingBox())!;
  const target = (await strip.locator('[data-group-id="c"]').boundingBox())!;
  await page.mouse.move(source.x + 20, source.y + 16); await page.mouse.down();
  await page.mouse.move(source.x + 20 + target.width / 2 + 16, source.y + 16, { steps: 8 });
  const preview = page.locator('[data-reorder-preview="item"]');
  await expect(preview).toContainText('A much longer middle terminal title');
  expect((await preview.boundingBox())!.width).toBeCloseTo(source.width, 0);
  await page.screenshot({ path: info.outputPath('whole-group-bounds.png'), animations: 'disabled' });
  await page.mouse.up();
  expect(await strip.locator('[data-group-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-group-id')))).toEqual(['a', 'c', 'b']);
});
