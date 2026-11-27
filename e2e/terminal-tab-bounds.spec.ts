import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

for (const direction of ['left', 'right'] as const)
  test(`unequal terminal tabs exchange by their bounds toward the ${direction}`, async ({ page }, info) => {
    await setupTauriMock(page, {});
    await page.goto('/');
    await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
    const ids = await page.evaluate(async () => {
      const path = '/src/features/workspace/stores/workspace.ts';
      const { useWorkspaceStore } = (await import(path)) as typeof import('../src/features/workspace/stores/workspace');
      useWorkspaceStore.getState().addTab();
      useWorkspaceStore.getState().addTab();
      const state = useWorkspaceStore.getState();
      const tabs = state.tabs.filter((tab) => tab.kind === 'session');
      const titles = ['A', 'A much longer middle terminal title', 'C'];
      useWorkspaceStore.setState({
        tabs: state.tabs.map((tab) => ({
          ...tab,
          title: titles[tabs.findIndex((item) => item.id === tab.id)] ?? tab.title,
          titleSource: 'manual' as const,
        })),
      });
      return tabs.map((tab) => tab.id);
    });
    const strip = page.getByTestId('workspace-instance-bar');
    const middle = strip.locator(`[data-tab-row-id="${ids[1]}"]`);
    const active = strip.locator(`[data-tab-row-id="${ids[2]}"]`).getByRole('tab');
    const neighbor = strip.locator(`[data-tab-row-id="${ids[direction === 'left' ? 0 : 2]}"]`);
    const source = (await middle.boundingBox())!,
      target = (await neighbor.boundingBox())!;
    const creation = strip.locator('.folder-create');
    const creationX = (await creation.boundingBox())!.x;
    expect(source.width).toBeGreaterThan(target.width);
    const grab = direction === 'right' ? 35 : source.width - 35;
    const delta = (target.width / 2 + 12) * (direction === 'right' ? 1 : -1);
    await page.mouse.move(source.x + grab, source.y + 16);
    await page.mouse.down();
    await expect(active).toHaveAttribute('aria-selected', 'true');
    await page.mouse.move(source.x + grab + delta, source.y + 16, { steps: 8 });
    const preview = page.locator('[data-reorder-preview="item"]');
    await expect(preview).toBeVisible();
    expect((await creation.boundingBox())!.x).toBeCloseTo(creationX, 0);
    expect((await preview.boundingBox())!.width).toBeCloseTo(source.width, 0);
    await expect(active).toHaveAttribute('aria-selected', 'true');
    await page.screenshot({ path: info.outputPath(`tab-bounds-${direction}.png`), animations: 'disabled' });
    await page.mouse.up();
    expect(
      await strip
        .locator('[data-tab-row-id]')
        .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-tab-row-id'))),
    ).toEqual(direction === 'right' ? [ids[0], ids[2], ids[1]] : [ids[1], ids[0], ids[2]]);
    await expect(active).toHaveAttribute('aria-selected', 'true');
    const inactiveTab = middle.getByRole('tab');
    const bounds = (await inactiveTab.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await expect(active).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(active).toHaveAttribute('aria-selected', 'true');
    const orderAfterDrop = await strip
      .locator('[data-tab-row-id]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-tab-row-id')));
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x, bounds.y + 150, { steps: 8 });
    await expect(preview).toBeVisible();
    await page.mouse.up();
    expect(
      await strip
        .locator('[data-tab-row-id]')
        .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-tab-row-id'))),
    ).toEqual(orderAfterDrop);
    await expect(active).toHaveAttribute('aria-selected', 'true');
    await inactiveTab.click();
    await expect(inactiveTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-terminal-input]:visible')).toBeFocused();
    await middle.getByRole('button', { name: '关闭标签' }).click();
    await expect(middle).toHaveCount(0);
  });

test.describe('at 125 percent display scaling', () => {
  test.use({ deviceScaleFactor: 1.25 });

  test('a trailing drag makes room beside the tabs and keeps the selected tab surface', async ({ page }) => {
    await setupTauriMock(page, {});
    await page.goto('/');
    await page.getByTestId('tab-new-default').click();
    const strip = page.getByTestId('workspace-instance-bar');
    const active = strip.getByRole('tab', { selected: true });
    const row = active.locator('xpath=../..');
    const creation = strip.locator('.folder-create');
    const resting = (await creation.boundingBox())!;
    const button = (await active.boundingBox())!;
    const color = await page.getByTestId('workspace-context-bar').evaluate((element) => getComputedStyle(element).backgroundColor);
    await expect(row).toHaveCSS('background-color', color);
    const y = button.y + button.height / 2;
    await page.mouse.move(button.x + button.width / 2, y);
    await page.mouse.down();
    await expect(active).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(row).toHaveCSS('background-color', color);
    await page.mouse.move(resting.x + 26, y, { steps: 8 });
    const preview = page.locator('[data-reorder-preview="item"] .folder-tab-preview');
    await expect(preview).toHaveCSS('background-color', color);
    expect(
      await preview.evaluate((element) =>
        ['::before', '::after'].map((part) => {
          const corner = getComputedStyle(element, part);
          return { display: corner.display, background: corner.backgroundColor };
        }),
      ),
    ).toEqual([
      { display: 'block', background: color },
      { display: 'block', background: color },
    ]);
    const shifted = (await creation.boundingBox())!;
    const moving = (await preview.boundingBox())!;
    expect(shifted.x).toBeGreaterThan(resting.x + 8);
    expect(moving.x + moving.width).toBeLessThanOrEqual(shifted.x);
    const screenshot = await page.screenshot({ animations: 'disabled' });
    const pixels = await page.evaluate(
      async ({ png, moving }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${png}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        const x = Math.floor((moving.x + moving.width / 2) * devicePixelRatio);
        const y = Math.floor((moving.y + moving.height) * devicePixelRatio);
        return [y - 1, y, y + 1].map((row) => Array.from(context.getImageData(x, row, 1, 1).data));
      },
      { png: screenshot.toString('base64'), moving },
    );
    const [tabPixel, joinPixel, toolbarPixel] = pixels;
    expect([tabPixel, joinPixel]).toEqual([toolbarPixel, toolbarPixel]);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect((await creation.boundingBox())!.x).toBeCloseTo(resting.x, 0);
    await expect(active).toBeVisible();
  });
});

test('group dragging shows one folded preview and moves the whole group', async ({ page }, info) => {
  await setupTauriMock(page, {});
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/src/features/workspace/stores/workspace.ts';
    const { useWorkspaceStore } = (await import(path)) as typeof import('../src/features/workspace/stores/workspace');
    useWorkspaceStore.getState().addTab();
    useWorkspaceStore.getState().addTab();
    const state = useWorkspaceStore.getState();
    const sessions = state.tabs.filter((tab) => tab.kind === 'session');
    const groups = ['a', 'b', 'c'].map((id) => ({ id, title: id.toUpperCase(), collapsed: false }));
    useWorkspaceStore.setState({
      groups,
      tabs: state.tabs.map((tab) => {
        const index = sessions.findIndex((item) => item.id === tab.id);
        return tab.kind === 'session'
          ? {
              ...tab,
              groupId: groups[index]!.id,
              title: index === 1 ? 'A much longer middle terminal title' : groups[index]!.title,
              titleSource: 'manual' as const,
            }
          : tab;
      }),
    });
  });
  const strip = page.getByTestId('workspace-instance-bar');
  const source = (await strip.locator('[data-group-id="b"]').boundingBox())!;
  const target = (await strip.locator('[data-group-id="c"]').boundingBox())!;
  await page.mouse.move(source.x + 20, source.y + 16);
  await page.mouse.down();
  await page.mouse.move(source.x + 20 + target.width / 2 + 16, source.y + 16, { steps: 8 });
  const preview = page.locator('[data-reorder-preview="item"]');
  await expect(preview).toContainText('B');
  expect((await preview.boundingBox())!.width).toBeLessThan(source.width);
  await page.screenshot({ path: info.outputPath('whole-group-bounds.png'), animations: 'disabled' });
  await page.mouse.up();
  expect(
    await strip.locator('[data-group-id]').evaluateAll((elements) => elements.map((element) => element.getAttribute('data-group-id'))),
  ).toEqual(['a', 'c', 'b']);
});
