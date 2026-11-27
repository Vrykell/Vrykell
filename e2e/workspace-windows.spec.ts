import { expect, test, type Page } from '@playwright/test';
import { emitPtyOutput, setupTauriMock } from './tauri-mock';
import { pickPlacementZone } from './placement';

const bar = (page: Page) => page.getByTestId('workspace-instance-bar');
const editor = (page: Page) => page.getByTestId('file-editor');

test('a new workspace opens history and AI around the terminal and respects a later layout change', async ({ page }, info) => {
  await setupTauriMock(page, { freshWorkspace: true });
  await page.setViewportSize({ width: 1240, height: 800 });
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.application-window')).toHaveAttribute('data-desktop-tint', 'false');
  const sidebar = page.getByTestId('workspace-sidebar');
  const history = sidebar.getByTestId('panel-drag-handle-command-history');
  const assistant = page.getByTestId('panel-drag-handle-chat');
  await expect(history).toBeVisible();
  await expect(assistant).toBeVisible();
  await expect(sidebar.getByTestId('workspace-area-terminal')).toHaveAttribute('aria-current', 'page');
  const bounds = (await sidebar.boundingBox())!;
  expect(bounds.width).toBe(288);
  expect((await sidebar.getByTestId('workspace-area-unified').boundingBox())!.y).toBeLessThan(
    (await sidebar.getByTestId('workspace-area-ssh').boundingBox())!.y,
  );
  await page.screenshot({ path: info.outputPath('first-launch.png') });
  await assistant.getByRole('button', { name: /关闭/ }).click();
  await page.reload();
  await expect(history).toBeVisible();
  await expect(assistant).toBeHidden();
});

test('creation menus open below their controls for mouse and keyboard', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(bar(page).getByTestId('tab-new-btn')).toBeVisible();
  const terminalOptions = bar(page).getByTestId('tab-new-btn');
  await terminalOptions.click();
  const terminalPicker = page.getByRole('dialog', { name: '新建标签页' });
  await expect(terminalPicker).toBeVisible();
  expect((await terminalPicker.boundingBox())!.y).toBeGreaterThan(
    (await terminalOptions.boundingBox())!.y + (await terminalOptions.boundingBox())!.height,
  );
  await page.keyboard.press('Escape');
  await page.getByTestId('workspace-area-unified').click();
  const plus = bar(page).getByRole('button', { name: '新建工作区标签' });
  const plusBox = (await plus.boundingBox())!;
  await plus.press('Enter');
  const menu = page.getByRole('menu', { name: '新建工作区标签' });
  await expect(menu).toBeVisible();
  expect((await menu.boundingBox())!.y).toBeGreaterThan(plusBox.y + plusBox.height);
  await page.keyboard.press('Escape');
  await expect(plus).toBeFocused();
  await page.getByTestId('workspace-area-ai').click();
  const agent = bar(page).getByTestId('harness-add-session');
  for (const activate of [() => agent.click(), () => agent.press('Enter')]) {
    const box = (await agent.boundingBox())!;
    await activate();
    const picker = page.getByRole('dialog', { name: '选择智能体' });
    await expect(picker).toBeVisible();
    expect((await picker.boundingBox())!.y).toBeGreaterThan(box.y + box.height);
    await page.keyboard.press('Escape');
    await expect(agent).toBeFocused();
  }
});

test('the default sidebar chat does not turn the last terminal into a tear-off', async ({ page, context }) => {
  await setupTauriMock(context, { freshWorkspace: true, workspaceWindows: true });
  await page.goto('/');
  await expect(page.getByTestId('ai-sidebar-content').locator('[data-chat-composer]')).toBeVisible();
  const onlyTab = bar(page).getByRole('tab', { selected: true });
  await expect(onlyTab).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __HOLD_WINDOW_DRAG__: boolean }).__HOLD_WINDOW_DRAG__ = true;
  });
  const box = (await onlyTab.boundingBox())!;
  const x = box.x + box.width / 2;
  await page.mouse.move(x, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, 180);
  await page.waitForFunction(() => '__WORKSPACE_DRAG__' in window);
  await page.evaluate(() => {
    (window as unknown as { __WORKSPACE_DRAG__: { release: (point: unknown) => void } }).__WORKSPACE_DRAG__.release({
      x: 5000,
      y: 490,
      over: '',
    });
  });
  await page.mouse.up();
  const operations = await page.evaluate(
    () => (window as unknown as { __WINDOW_OPS__: { command: string; value?: unknown }[] }).__WINDOW_OPS__,
  );
  expect(operations.find((op) => op.command === 'drag_workspace_window')?.value).toBe(true);
  expect(operations.some((op) => op.command === 'plugin:webview|create_webview_window')).toBe(false);
  expect(context.pages()).toHaveLength(1);
  await expect(onlyTab).toBeVisible();
});

async function openDrafts(page: Page) {
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await page.getByTestId('workspace-area-code').click();
  const create = bar(page).getByRole('button', { name: '新建文件', exact: true });
  await create.click();
  const first = bar(page).getByRole('tab', { name: /未命名 1/ });
  await expect(first).toHaveAttribute('aria-selected', 'true');
  const input = editor(page).locator('textarea.inputarea');
  await input.focus();
  await page.keyboard.insertText('Unsaved content follows the tab.');
  await expect(editor(page).locator('.view-lines')).toContainText('Unsaved content follows the tab.');
  await create.click();
  await expect(bar(page).getByRole('tab', { name: /未命名 2/ })).toHaveAttribute('aria-selected', 'true');
  return first;
}

test('a detached window keeps the grabbed tab under the pointer and can join a strip repeatedly', async ({ page, context }, info) => {
  await setupTauriMock(context, { workspaceWindows: true });
  const first = await openDrafts(page);
  const box = (await first.boundingBox())!;
  const x = Math.round(box.x + box.width / 2);
  const grip = await first.evaluate(
    (tab, point) => {
      const row = tab.closest('[data-reorder-item]')!.getBoundingClientRect();
      return { ratio: (point.x - row.x) / row.width, offsetY: point.y - row.y };
    },
    { x, y: box.y + box.height / 2 },
  );
  await page.evaluate(() => {
    (window as unknown as { __HOLD_WINDOW_DRAG__: boolean }).__HOLD_WINDOW_DRAG__ = true;
  });
  await page.mouse.move(x, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, 3, { steps: 8 });
  await expect(bar(page).locator('.folder-tab[data-reorder-dragging="true"]')).toHaveAttribute('data-active', 'true');
  await expect(editor(page).locator('.view-lines')).toContainText('Unsaved content follows the tab.');
  await expect(page.locator('[data-reorder-preview="item"]')).toContainText('未命名 1');
  expect(context.pages()).toHaveLength(1);
  const popup = page.waitForEvent('popup');
  await page.mouse.move(x, 125);
  const child = await popup;
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { __WINDOW_OPS__: { command: string }[] }).__WINDOW_OPS__.some((row) => row.command === 'plugin:window|show'),
      ),
    )
    .toBe(true);
  await expect(editor(child).locator('.view-lines')).toContainText('Unsaved content follows the tab.');
  const newTab = bar(child).locator('.folder-tab[data-active="true"]');
  await expect(newTab).toContainText('未命名 1');
  const aligned = (await newTab.boundingBox())!;
  const placement = await page.evaluate(() => {
    const { __WINDOW_OPS__: ops } = window as unknown as {
      __WINDOW_OPS__: { command: string; value?: { Physical?: { x: number; y: number } } }[];
    };
    return ops.filter((row) => row.command === 'plugin:window|set_position').at(-1)?.value?.Physical;
  });
  const expectedPointer = { x: x + 100, y: 225 };
  const actualPointer = { x: placement!.x + aligned.x + aligned.width * grip.ratio, y: placement!.y + aligned.y + grip.offsetY };
  const coordinates = JSON.stringify({ actualPointer, expectedPointer });
  expect(Math.abs(actualPointer.x - expectedPointer.x), coordinates).toBeLessThan(2);
  expect(Math.abs(actualPointer.y - expectedPointer.y), coordinates).toBeLessThan(2);
  await page.waitForFunction(() => '__WORKSPACE_DRAG__' in window);
  await page.evaluate(
    (point) => {
      (window as unknown as { __WORKSPACE_DRAG__: { sample: (point: unknown) => void } }).__WORKSPACE_DRAG__.sample(point);
    },
    { x: x + 100, y: 225, over: '' },
  );
  // A renderer move inside the source window must not override the native pointer.
  await page.mouse.move(x, 70);
  expect(child.isClosed()).toBe(false);
  await page.evaluate(
    (point) => {
      (window as unknown as { __WORKSPACE_DRAG__: { release: (point: unknown) => void } }).__WORKSPACE_DRAG__.release(point);
    },
    { x: x + 100, y: 225, over: '' },
  );
  await page.mouse.up();
  await expect(editor(child).locator('.view-lines')).toContainText('Unsaved content follows the tab.');
  await expect(bar(child).getByRole('tab', { name: /未命名 1/ })).toHaveAttribute('aria-selected', 'true');
  await expect(first).toHaveCount(0);
  await expect(bar(page).getByRole('tab', { name: /未命名 2/ })).toHaveAttribute('aria-selected', 'true');
  await bar(page)
    .getByRole('tab', { name: /未命名 2/ })
    .press('Shift+F10');
  await page.getByRole('button', { name: '新建分组', exact: true }).click();
  await page.getByRole('textbox', { name: '分组名称' }).fill('Review');
  await page.getByRole('textbox', { name: '分组名称' }).press('Enter');
  await child.screenshot({ path: info.outputPath('detached-draft.png') });
  const detached = bar(child).getByRole('tab', { name: /未命名 1/, selected: true });
  await child.evaluate(async () => {
    const path = '/src/features/chat/services/aiWorkspace.ts';
    const { createSideConversation } = (await import(path)) as typeof import('../src/features/chat/services/aiWorkspace');
    createSideConversation();
  });
  await detached.press('Shift+F10');
  await expect(child.getByText('将标签页移到新窗口', { exact: true })).toBeVisible();
  await expect(child.getByText('将标签页移到其他窗口', { exact: true })).toHaveCount(0);
  await child.keyboard.press('Escape');
  const destination = (await bar(page)
    .getByRole('tab', { name: /未命名 2/ })
    .boundingBox())!;
  await child.evaluate(() => {
    (window as unknown as { __HOLD_WINDOW_DRAG__: boolean }).__HOLD_WINDOW_DRAG__ = true;
  });
  const from = (await detached.boundingBox())!;
  const closed = child.waitForEvent('close');
  await child.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await child.mouse.down();
  await child.mouse.move(from.x + from.width / 2, 120);
  const client = { x: destination.x + destination.width / 2 + from.width / 2 - 4, y: destination.y + destination.height / 2 };
  const sample = {
    x: 1920 + client.x,
    y: 220 + client.y,
    over: 'main',
    client,
  };
  await child.waitForFunction(() => '__WORKSPACE_DRAG__' in window);
  await expect
    .poll(() =>
      child.evaluate(
        () =>
          (window as unknown as { __WINDOW_OPS__: { command: string; value?: unknown }[] }).__WINDOW_OPS__.find(
            (op) => op.command === 'drag_workspace_window',
          )?.value,
      ),
    )
    .toBe(true);
  await child.evaluate((point) => {
    (window as unknown as { __WORKSPACE_DRAG__: { sample: (point: { x: number; y: number }) => void } }).__WORKSPACE_DRAG__.sample(point);
  }, sample);
  const group = bar(page).locator('[data-group-card]');
  const incoming = group.getByRole('tab', { name: /未命名 1/, selected: true });
  const held = page.locator('[data-reorder-preview="item"] .folder-tab[data-active="true"]');
  await expect(held).toContainText('未命名 1');
  await expect(detached).toHaveCount(1);
  await expect(editor(page).locator('.view-lines')).toContainText('Unsaved content follows the tab.');
  await bar(page).screenshot({ path: info.outputPath('held-incoming-tab.png') });
  const outside = { x: 5000, y: 400, over: '' };
  await child.evaluate((point) => {
    (window as unknown as { __WORKSPACE_DRAG__: { sample: (point: unknown) => void } }).__WORKSPACE_DRAG__.sample(point);
  }, outside);
  await expect(held).toHaveCount(0);
  await expect(bar(page).getByRole('tab', { name: /未命名 1/ })).toHaveCount(0);
  await expect(detached).toBeVisible();
  await child.evaluate((point) => {
    (window as unknown as { __WORKSPACE_DRAG__: { sample: (point: unknown) => void } }).__WORKSPACE_DRAG__.sample(point);
  }, sample);
  await expect(held).toContainText('未命名 1');
  await child.mouse.up();
  await child
    .evaluate((point) => {
      (window as unknown as { __WORKSPACE_DRAG__: { release: (point: { x: number; y: number }) => void } }).__WORKSPACE_DRAG__.release(
        point,
      );
    }, sample)
    .catch((error) => {
      if (!child.isClosed()) throw error;
    });
  await closed;
  await expect(incoming).toBeVisible();
  await expect(editor(page).locator('.view-lines')).toContainText('Unsaved content follows the tab.');
});

for (const returnWhileHeld of [true, false]) {
  test(`returning to the source strip ${returnWhileHeld ? 'while held' : 'on release'} discards the temporary window`, async ({
    page,
    context,
  }) => {
    await setupTauriMock(context, { workspaceWindows: true });
    const first = await openDrafts(page);
    const box = (await first.boundingBox())!;
    const client = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.evaluate(() => {
      (window as unknown as { __HOLD_WINDOW_DRAG__: boolean }).__HOLD_WINDOW_DRAG__ = true;
    });
    await page.mouse.move(client.x, client.y);
    await page.mouse.down();
    const popup = page.waitForEvent('popup');
    await page.mouse.move(client.x, 125);
    const provisional = await popup;
    const closed = provisional.waitForEvent('close');
    const ops = () => page.evaluate(() => (window as unknown as { __WINDOW_OPS__: { command: string }[] }).__WINDOW_OPS__);
    await expect.poll(async () => (await ops()).some((row) => row.command === 'plugin:window|show')).toBe(true);
    const move = (action: 'sample' | 'release') =>
      page.evaluate(
        ({ client, action }) => {
          window.dispatchEvent(new FocusEvent('blur'));
          const drag = (window as unknown as { __WORKSPACE_DRAG__: Record<'sample' | 'release', (point: unknown) => void> })
            .__WORKSPACE_DRAG__;
          drag[action]({ x: client.x + 100, y: client.y + 100, over: 'main', client });
        },
        { client, action },
      );
    if (returnWhileHeld) {
      await move('sample');
      await closed;
      await expect(page.locator('[data-reorder-preview="item"]')).toContainText('未命名 1');
    }
    await move('release');
    await page.mouse.up();
    await closed;
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await expect(editor(page).locator('.view-lines')).toContainText('Unsaved content follows the tab.');
    expect((await ops()).filter((row) => row.command === 'plugin:webview|create_webview_window')).toHaveLength(1);
    expect(context.pages()).toHaveLength(1);
  });
}

test('a failed window creation leaves the unsaved original available from its tab', async ({ page, context }) => {
  await setupTauriMock(context, { workspaceWindows: true });
  await page.addInitScript(() => {
    (window as unknown as { __FAIL_WORKSPACE_WINDOW__: boolean }).__FAIL_WORKSPACE_WINDOW__ = true;
  });
  const first = await openDrafts(page);
  await first.press('Shift+F10');
  await page.getByText('将标签页移到新窗口', { exact: true }).click();
  await expect(page.locator('#app-notifications').getByRole('alert')).toBeVisible();
  await first.click();
  await expect(editor(page).locator('.view-lines')).toContainText('Unsaved content follows the tab.');
  expect(context.pages()).toHaveLength(1);
});

test('reorders the selected returning tab before release', async ({ page, context }) => {
  await setupTauriMock(context, { workspaceWindows: true });
  const first = await openDrafts(page);
  await bar(page).getByRole('button', { name: '新建文件', exact: true }).click();
  await first.click({ button: 'right' });
  const opened = page.waitForEvent('popup');
  await page.getByText('将标签页移到新窗口', { exact: true }).click();
  const child = await opened;
  const detached = bar(child).getByRole('tab', { name: /未命名 1/ });
  await expect(detached).toBeVisible();
  await expect(first).toHaveCount(0);
  if (!(await child.getByTestId('workspace-area-terminal').isVisible())) await child.getByTestId('workspace-sidebar-expand').click();
  await child.getByTestId('workspace-area-terminal').click();
  await bar(child).getByTestId('tab-new-default').click();
  await expect(child.getByPlaceholder(/输入命令/)).toBeVisible();
  await child.getByTestId('workspace-area-code').click();
  const strip = bar(page);
  const second = strip.locator('.folder-tab[data-reorder-item]').filter({ hasText: '未命名 2' });
  const { x, y, width, height } = (await second.boundingBox())!;
  await page.getByTestId('workspace-area-terminal').click();
  await expect(page.getByTestId('workspace-area-terminal')).toHaveAttribute('aria-current', 'page');
  const from = (await detached.boundingBox())!;
  await child.evaluate(() => {
    (window as unknown as { __HOLD_WINDOW_DRAG__: boolean }).__HOLD_WINDOW_DRAG__ = true;
  });
  await child.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await child.mouse.down();
  await child.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2);
  await child.waitForFunction(() => '__WORKSPACE_DRAG__' in window);
  const held = (delta: number, action: 'sample' | 'release' = 'sample') =>
    child.evaluate(
      ({ point, action }) => {
        (window as unknown as { __WORKSPACE_DRAG__: Record<'sample' | 'release', (point: unknown) => void> }).__WORKSPACE_DRAG__[action](
          point,
        );
      },
      {
        action,
        point: {
          x: 1920 + x + width / 2 + from.width / 2 + delta,
          y: 220 + y + height / 2,
          over: 'main',
          client: { x: x + width / 2 + from.width / 2 + delta, y: y + height / 2 },
        },
      },
    );
  const rows = strip.locator('.folder-tab[data-reorder-item]');
  const returned = page.locator('[data-reorder-preview="item"] .folder-tab[data-active="true"]');
  const slotBefore = strip.locator('[data-reorder-placeholder] + .folder-tab[data-reorder-item]');
  await held(-12);
  await expect(page.getByTestId('workspace-area-code')).toHaveAttribute('aria-current', 'page');
  await expect(returned).toContainText('未命名 1');
  await expect(bar(child).locator('[data-reorder-item]').filter({ hasText: '未命名 1' })).toHaveCount(1);
  await expect(slotBefore).toContainText('未命名 2');
  await child.evaluate(
    (client) => {
      const state = window as unknown as {
        __TAURI_INTERNALS__: { metadata: { currentWindow: { label: string } } };
        __WORKSPACE_DRAG__: { sample: (point: unknown) => void };
      };
      state.__WORKSPACE_DRAG__.sample({
        x: client.x + 100,
        y: client.y + 100,
        client,
        over: state.__TAURI_INTERNALS__.metadata.currentWindow.label,
      });
    },
    { x: from.x + from.width / 2, y: from.y + from.height / 2 },
  );
  await expect(returned).toHaveCount(0);
  await expect(page.getByTestId('workspace-area-terminal')).toHaveAttribute('aria-current', 'page');
  await held(-12);
  await expect(returned).toContainText('未命名 1');
  await expect(slotBefore).toContainText('未命名 2');
  await held(12);
  await expect(slotBefore).toContainText('未命名 3');
  await held(-12);
  await expect(slotBefore).toContainText('未命名 2');
  await held(12);
  await expect(slotBefore).toContainText('未命名 3');
  await child.mouse.up();
  await held(12, 'release');
  await expect(strip.getByRole('tab', { name: /未命名 1/ })).toHaveAttribute('aria-selected', 'true');
  await expect(rows).toHaveText([/未命名 2/, /未命名 1/, /未命名 3/]);
  await child.getByTestId('workspace-area-terminal').click();
  await expect(child.getByPlaceholder(/输入命令/)).toBeVisible();
});

test('a tab drag survives loss of webview capture and uses the native release once', async ({ page, context }) => {
  await setupTauriMock(context, { workspaceWindows: true });
  const first = await openDrafts(page);
  const from = (await first.boundingBox())!;
  const x = from.x + from.width / 2;
  const y = from.y + from.height / 2;
  await page.evaluate(() => {
    (window as unknown as { __HOLD_WINDOW_DRAG__: boolean }).__HOLD_WINDOW_DRAG__ = true;
  });
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 10, y);
  await page.waitForFunction(() => '__WORKSPACE_DRAG__' in window);
  const opened = page.waitForEvent('popup');
  await page.evaluate(
    (point) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', repeat: true }));
      window.dispatchEvent(new FocusEvent('blur'));
      (window as unknown as { __WORKSPACE_DRAG__: { release: (point: { x: number; y: number }) => void } }).__WORKSPACE_DRAG__.release(
        point,
      );
    },
    { x: 100 + x, y: 60 },
  );
  const child = await opened;
  await page.mouse.up();
  await expect(editor(child).locator('.view-lines')).toContainText('Unsaved content follows the tab.');
  await expect(first).toHaveCount(0);
  expect(context.pages()).toHaveLength(2);
});

test('detaching a group keeps its members together and permits dragging the group back', async ({ page, context }) => {
  await setupTauriMock(context, { workspaceWindows: true });
  const first = await openDrafts(page);
  await first.press('Shift+F10');
  await page.getByRole('button', { name: '新建分组', exact: true }).click();
  await page.getByRole('textbox', { name: '分组名称' }).fill('Notes');
  await page.getByRole('textbox', { name: '分组名称' }).press('Enter');
  const second = bar(page).getByRole('tab', { name: /未命名 2/ });
  await second.press('Shift+F10');
  await page.getByRole('menuitem', { name: '移至标签组', exact: true }).press('ArrowRight');
  await page.getByRole('button', { name: 'Notes', exact: true }).last().click();
  await bar(page).getByRole('button', { name: '新建文件', exact: true }).click();
  const group = (target: Page) =>
    bar(target)
      .locator('[data-group-card]')
      .filter({ has: target.getByRole('button', { name: 'Notes' }) });
  await expect(group(page).getByRole('tab')).toHaveCount(2);
  const groupHeader = (target: Page) => bar(target).getByRole('button', { name: 'Notes', exact: true });
  const from = (await groupHeader(page).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  const opened = page.waitForEvent('popup');
  await page.mouse.move(from.x + from.width / 2, 145, { steps: 5 });
  await page.mouse.up();
  const child = await opened;
  await expect(group(child).getByRole('tab')).toHaveCount(2);
  await expect(group(page)).toHaveCount(0);
  await expect(bar(page).getByRole('tab', { name: /未命名 3/ })).toBeVisible();
  const to = (await bar(page)
    .getByRole('tab', { name: /未命名 3/ })
    .boundingBox())!;
  await child.evaluate((box) => {
    (window as unknown as { __WINDOW_DRAG_RELEASE__: [number, number] }).__WINDOW_DRAG_RELEASE__ = [
      100 + box.x + 4,
      100 + box.y + box.height / 2,
    ];
  }, to);
  const childGroup = (await groupHeader(child).boundingBox())!;
  const closed = child.waitForEvent('close');
  await child.mouse.move(childGroup.x + childGroup.width / 2, childGroup.y + childGroup.height / 2);
  await child.mouse.down();
  await child.mouse.move(childGroup.x + childGroup.width / 2, 120);
  await child.mouse.up().catch((error) => {
    if (!child.isClosed()) throw error;
  });
  await closed;
  await expect(group(page).getByRole('tab')).toHaveCount(2);
  await first.click();
  await expect(editor(page).locator('.view-lines')).toContainText('Unsaved content follows the tab.');
});

test('moves a starting terminal after its first prompt resolves the working directory', async ({ page, context }) => {
  await setupTauriMock(context, { workspaceWindows: true, shellReadyMarker: false });
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await bar(page).getByRole('tab', { selected: true }).press('Shift+F10');
  const popup = page.waitForEvent('popup');
  await page.getByText('将标签页移到新窗口', { exact: true }).click();
  await page.waitForFunction(async () => {
    const path = '/src/platform/diagnostics.ts';
    const { diagnosticSnapshot } = (await import(path)) as typeof import('../src/platform/diagnostics');
    return diagnosticSnapshot().some((record) => record.event === 'workspace-window-move-start');
  });
  await emitPtyOutput(page, '\x1b]7;file://host/home/e2e/ready-directory\x07\x1b]133;B\x07');
  const child = await popup;
  await expect(child.getByPlaceholder(/输入命令/)).toBeEditable();
  await expect(child.getByText(/ready-directory/).first()).toBeVisible();
  await expect(bar(page).locator('[data-tab-kind="session"]')).toHaveCount(0);
});

test('moves an idle terminal from its menu without spawning another shell', async ({ page, context }) => {
  await setupTauriMock(context, { workspaceWindows: true });
  await page.goto('/');
  const input = page.getByPlaceholder(/输入命令/);
  await expect(input).toBeVisible();
  await page.waitForFunction(async () => {
    const path = '/src/features/terminal/stores/terminal.ts';
    const { useTerminalStore } = (await import(path)) as typeof import('../src/features/terminal/stores/terminal');
    return Object.values(useTerminalStore.getState().startupStates).includes('ready');
  });
  await input.fill('echo Previous output');
  await input.press('Enter');
  await expect(page.getByText('Previous output', { exact: true })).toBeVisible();
  await expect(page.getByTestId('exit-code').first()).toHaveText('0');
  await expect(input).toBeEditable();
  await input.fill('unsent command');
  const tab = bar(page).getByRole('tab', { selected: true });
  await tab.press('Shift+F10');
  const popup = page.waitForEvent('popup', { timeout: 12_000 });
  await page.getByText('将标签页移到新窗口', { exact: true }).click();
  const child = await popup.catch(async (error) => {
    const alert = page.locator('#app-notifications').getByRole('alert');
    if (!(await alert.isVisible())) throw error;
    await alert.getByRole('button', { name: '技术详情' }).click();
    throw new Error(await alert.innerText(), { cause: error });
  });
  await expect(child.getByText('Previous output', { exact: true })).toBeVisible();
  await expect(child.getByPlaceholder(/输入命令/)).toHaveValue('unsent command');
  const ptyOperations = (target: Page) =>
    target.evaluate(() => ({
      spawns: (window as unknown as { __PTY_SPAWNS__: unknown[] }).__PTY_SPAWNS__.length,
      closes: (window as unknown as { __PTY_CLOSES__: unknown[] }).__PTY_CLOSES__.length,
      moves: (window as unknown as { __WINDOW_OPS__: { command: string }[] }).__WINDOW_OPS__.filter(
        (row) => row.command === 'pty_move_to_window',
      ).length,
    }));
  await expect.poll(() => ptyOperations(page)).toEqual({ spawns: 1, closes: 0, moves: 1 });
  await expect.poll(() => ptyOperations(child)).toMatchObject({ spawns: 0 });
  await expect(bar(page).locator('[data-tab-kind="session"]')).toHaveCount(0);
});

test('drags an AI conversation into a new window with its draft', async ({ page, context }) => {
  await setupTauriMock(context, { workspaceWindows: true });
  await page.goto('/');
  await page.getByTestId('workspace-area-ai').click();
  const startChat = async () => {
    await bar(page).getByTestId('harness-add-session').click();
    await page.getByRole('dialog', { name: '选择智能体' }).getByTestId('ai-start-new-conversation').click();
  };
  await startChat();
  await page.locator('[data-chat-composer]:visible').fill('Conversation draft moves with me');
  await startChat();
  const first = bar(page).getByRole('tab').first();
  const box = (await first.boundingBox())!;
  await page.evaluate(() => {
    (window as unknown as { __HOLD_WINDOW_DRAG__: boolean }).__HOLD_WINDOW_DRAG__ = true;
  });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  const popup = page.waitForEvent('popup');
  await page.mouse.move(box.x + box.width / 2, 154, { steps: 8 });
  await page.waitForFunction(() => '__WORKSPACE_DRAG__' in window);
  const child = await popup;
  const x = 100 + box.x + box.width / 2;
  const localPreview = page.locator('[data-reorder-preview="item"]');
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { __WINDOW_OPS__: { command: string; label?: string }[] }).__WINDOW_OPS__.some(
          (op) => op.command === 'plugin:window|show' && op.label?.startsWith('app-'),
        ),
      ),
    )
    .toBe(true);
  await expect(localPreview).toBeHidden();
  await expect(child.locator('[data-chat-composer]:visible')).toHaveValue('Conversation draft moves with me');
  await page.evaluate(
    (point) => {
      (window as unknown as { __WORKSPACE_DRAG__: { release: (point: unknown) => void } }).__WORKSPACE_DRAG__.release(point);
    },
    { x, y: 60, over: '' },
  );
  await page.mouse.up();
  await expect(child.locator('[data-chat-composer]:visible')).toHaveValue('Conversation draft moves with me');
  await expect(bar(page).getByRole('tab')).toHaveCount(1);
});

test('moves a mixed workspace with the live shell and both unsaved drafts', async ({ page, context }) => {
  await setupTauriMock(context, { workspaceWindows: true });
  await page.goto('/');
  await page.getByTestId('workspace-area-unified').click();
  const unified = page.getByTestId('unified-workspace');
  await unified.getByTestId('unified-start-page').getByRole('button', { name: '新对话', exact: true }).click();
  await unified.locator('[data-chat-composer]').fill('Mixed conversation draft');
  await page.keyboard.press('Control+d');
  await page.getByRole('menuitem', { name: '新建工作区标签', exact: true }).press('ArrowRight');
  await page.getByRole('menuitem', { name: '新建文件', exact: true }).click();
  await pickPlacementZone(page, unified.locator('.unified-pane').first(), 'right');
  await expect(unified.locator('.unified-pane')).toHaveCount(2);
  await editor(page).locator('textarea.inputarea:visible').focus();
  await page.keyboard.insertText('Mixed editor draft');
  await bar(page).getByRole('tab', { selected: true }).press('Control+d');
  await page.getByRole('menuitem', { name: '终端', exact: true }).click();
  await pickPlacementZone(page, unified.locator('.unified-pane').last(), 'bottom');
  await expect(unified.locator('.unified-pane')).toHaveCount(3);
  await unified.getByPlaceholder(/输入命令/).fill('Mixed shell draft');
  await bar(page).getByRole('tab', { selected: true }).press('Shift+F10');
  const popup = page.waitForEvent('popup');
  await page.getByText('将标签页移到新窗口', { exact: true }).click();
  const child = await popup;
  const received = child.getByTestId('unified-workspace');
  await expect(received.locator('.unified-pane')).toHaveCount(3);
  await expect(received.locator('[data-chat-composer]')).toHaveValue('Mixed conversation draft');
  await expect(editor(child).locator('.view-lines')).toContainText('Mixed editor draft');
  await expect(received.getByPlaceholder(/输入命令/)).toHaveValue('Mixed shell draft');
  await expect.poll(() => child.evaluate(() => (window as unknown as { __PTY_SPAWNS__: unknown[] }).__PTY_SPAWNS__.length)).toBe(0);
  await expect(unified.getByTestId('unified-start-page')).toBeVisible();
});

test('dragging the only tab starts a window drag and does not create a window', async ({ page, context }) => {
  await setupTauriMock(context, { workspaceWindows: true });
  await page.goto('/');
  const tab = bar(page).getByRole('tab', { selected: true });
  const bounds = (await tab.boundingBox())!;
  const x = bounds.x + bounds.width / 2;
  await page.mouse.move(x, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, 130, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __WINDOW_OPS__: { command: string }[] }).__WINDOW_OPS__.filter(
            (row) => row.command === 'drag_workspace_window',
          ).length,
      ),
    )
    .toBe(1);
  expect(context.pages()).toHaveLength(1);
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-reorder-preview="item"]')).toHaveCount(0);
});

test('restores the docked source when the receiving window disappears', async ({ page, context }) => {
  await setupTauriMock(context, { workspaceWindows: true });
  await page.goto('/');
  const tab = bar(page).getByRole('tab', { selected: true });
  const bounds = (await tab.boundingBox())!;
  await page.evaluate(() => {
    (window as unknown as { __HOLD_WINDOW_DRAG__: boolean }).__HOLD_WINDOW_DRAG__ = true;
  });
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2, 130);
  await page.waitForFunction(() => '__WORKSPACE_DRAG__' in window);
  await page.mouse.up();
  await page.evaluate(() => {
    (window as unknown as { __WORKSPACE_DRAG__: { release: (point: unknown) => void } }).__WORKSPACE_DRAG__.release({
      x: 500,
      y: 120,
      over: 'app-closed',
      client: { x: 180, y: 20 },
      dock: 17,
    });
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __WINDOW_OPS__: { command: string; value?: unknown }[] }).__WINDOW_OPS__.find(
            (op) => op.command === 'restore_workspace_dock',
          )?.value,
      ),
    )
    .toBe(17);
  await expect(tab).toHaveAttribute('aria-selected', 'true');
});
