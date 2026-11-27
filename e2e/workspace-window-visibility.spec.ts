import { expect as baseExpect, test, type BrowserContext, type Page } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

const expect = baseExpect.configure({ timeout: 25_000 });
const strip = (page: Page) => page.getByTestId('workspace-instance-bar');
const areaLabel = (page: Page) => page.getByTestId('workspace-context-bar');
const draft = (page: Page) => strip(page).locator('[data-reorder-item]').filter({ hasText: '未命名 1' });
const groupTitle = 'Window visibility';
const group = (page: Page) => strip(page).getByRole('button', { name: groupTitle, exact: true });
const contents = 'Draft retained across window visits';

interface Sample {
  x: number;
  y: number;
  over: string;
  client?: { x: number; y: number };
}

const desktop = { x: 1510, y: 420, over: '' };

const readLabel = (page: Page) =>
  page.evaluate(() => {
    const state = window as unknown as { __TAURI_INTERNALS__: { metadata: { currentWindow: { label: string } } } };
    return state.__TAURI_INTERNALS__.metadata.currentWindow.label;
  });

const visibility = (page: Page, label: string) =>
  page.evaluate((label) => localStorage.getItem(`e2e-window-surface:${label}`) ?? 'visible', label);

const pointer = (page: Page, action: 'sample' | 'release', point: Sample | null) =>
  page.evaluate(
    ({ action, point }) => {
      const state = window as unknown as { __WORKSPACE_DRAG__: Record<'sample' | 'release', (sample: Sample | null) => void> };
      state.__WORKSPACE_DRAG__[action](point);
    },
    { action, point },
  );

async function selectArea(page: Page, area: 'terminal' | 'code') {
  const item = page.getByTestId(`workspace-area-${area}`);
  const expand = page.getByTestId('workspace-sidebar-expand');
  await expect(item.or(expand).filter({ visible: true }).first()).toBeVisible();
  if (!(await item.isVisible())) await expand.click();
  await item.click({ timeout: 10_000 });
}

async function openPeer(page: Page) {
  const popup = page.waitForEvent('popup');
  await page.evaluate(async () => {
    const path = '/src/platform/appWindows.ts';
    const { openAppWindow } = (await import(path)) as typeof import('../src/platform/appWindows');
    openAppWindow();
  });
  const peer = await popup;
  await peer.setViewportSize({ width: 1240, height: 800 });
  await expect(strip(peer).getByRole('tab', { selected: true })).toBeVisible({ timeout: 30_000 });
  await expect(areaLabel(peer)).toHaveText('终端会话');
  return peer;
}

const sources = [
  { name: 'one tab', grouped: false, remaining: false },
  { name: 'one of two tabs', grouped: false, remaining: true },
  { name: 'one group alone', grouped: true, remaining: false },
  { name: 'one group alongside a tab', grouped: true, remaining: true },
] as const;
type Source = (typeof sources)[number];

async function prepareSource(page: Page, context: BrowserContext, source: Source) {
  await setupTauriMock(context, { workspaceWindows: true });
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeEditable({ timeout: 90_000 });
  await expect(strip(page).getByRole('tab', { selected: true })).toBeVisible();
  await strip(page).getByRole('button', { name: '关闭标签' }).click();
  await selectArea(page, 'code');
  const create = strip(page).getByRole('button', { name: '新建文件', exact: true });
  await create.click();
  const editor = page.getByTestId('file-editor');
  await editor.locator('textarea.inputarea').focus();
  await page.keyboard.insertText(contents);
  await expect(editor.locator('.view-lines')).toContainText(contents);
  if (source.grouped || source.remaining) await create.click();
  if (source.grouped) {
    await draft(page).getByRole('tab').click({ button: 'right' });
    await page.getByRole('button', { name: '新建分组', exact: true }).click({ timeout: 10_000 });
    await page.getByRole('textbox', { name: '分组名称' }).fill(groupTitle);
    await page.getByRole('textbox', { name: '分组名称' }).press('Enter');
    await strip(page)
      .getByRole('tab', { name: /未命名 2/ })
      .click({ button: 'right' });
    await page.getByRole('menuitem', { name: '移至标签组', exact: true }).press('ArrowRight');
    await page.getByRole('button', { name: groupTitle, exact: true }).last().click();
    if (source.remaining) await create.click();
  }
  const first = source.grouped ? group(page) : draft(page).getByRole('tab');
  const expanded = source.grouped ? await first.getAttribute('aria-expanded') : null;
  return { first, expanded };
}

async function startDrag(page: Page, source: Source, first = source.grouped ? group(page) : draft(page).getByRole('tab')): Promise<Sample> {
  const box = (await first.boundingBox())!;
  const client = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.evaluate(() => {
    (window as unknown as { __HOLD_WINDOW_DRAG__: boolean }).__HOLD_WINDOW_DRAG__ = true;
  });
  await page.mouse.move(client.x, client.y);
  await page.mouse.down();
  await page.mouse.move(client.x, client.y + 8);
  await page.waitForFunction(() => '__WORKSPACE_DRAG__' in window);
  return { x: client.x + 100, y: client.y + 100, over: await readLabel(page), client };
}

async function hitTestPoint(peer: Page): Promise<Sample> {
  const box = (await strip(peer).getByRole('tab', { selected: true }).boundingBox())!;
  return { x: 1500, y: 40, over: await readLabel(peer), client: { x: box.x + box.width / 2, y: box.y + box.height / 2 } };
}

const incomingPreview = (peer: Page, source: Source) =>
  peer.locator('[data-reorder-preview="item"]').filter({ hasText: source.grouped ? groupTitle : '未命名 1' });

async function expectDraft(owner: Page, expanded: string | null) {
  if (expanded !== null) {
    await expect(group(owner)).toHaveAttribute('aria-expanded', expanded);
    if (expanded === 'false') await group(owner).click();
  }
  const retained = draft(owner).getByRole('tab');
  await expect(retained).toBeVisible();
  await retained.click();
  await expect(owner.getByTestId('file-editor').locator('.view-lines')).toContainText(contents);
}

const resolutions = ['receiving strip', 'desktop', 'original strip', 'cancelled', 'receiver closed'] as const;

for (const source of sources)
  for (const resolution of resolutions) {
    // With no remaining tabs, the original strip travels as part of the window.
    if (resolution === 'original strip' && !source.remaining) continue;
    test(`${source.name} stays consistent across repeated visits ending on ${resolution}`, async ({ page, context }) => {
      const { first, expanded } = await prepareSource(page, context, source);
      const peer = await openPeer(page);
      const target = await hitTestPoint(peer);
      const peerLabel = target.over;
      const original = await startDrag(page, source);
      const label = original.over;
      const incoming = incomingPreview(peer, source);
      const opened = source.remaining ? page.waitForEvent('popup') : undefined;
      await pointer(page, 'sample', desktop);
      const detached = opened ? await opened : undefined;
      const detachedLabel = detached ? await readLabel(detached) : undefined;
      if (detachedLabel) await expect.poll(() => visibility(page, detachedLabel)).toBe('visible');
      expect(context.pages()).toHaveLength(source.remaining ? 3 : 2);

      async function enterPeer() {
        await pointer(page, 'sample', target);
        await expect(incoming).toBeVisible();
        await expect(areaLabel(peer)).toHaveText('项目文件');
        await expect.poll(() => visibility(page, label)).toBe(source.remaining ? 'visible' : 'cloaked');
        await expect.poll(() => visibility(page, peerLabel)).toBe('visible');
        if (detachedLabel) await expect.poll(() => visibility(page, detachedLabel)).toBe('hidden');
      }

      await enterPeer();
      await pointer(page, 'sample', desktop);
      await expect(incoming).toHaveCount(0);
      await expect(areaLabel(peer)).toHaveText('终端会话');
      await expect.poll(() => visibility(page, label)).toBe('visible');
      if (detachedLabel) await expect.poll(() => visibility(page, detachedLabel)).toBe('visible');
      expect(context.pages()).toHaveLength(source.remaining ? 3 : 2);
      await enterPeer();

      if (resolution === 'receiver closed') {
        await peer.close();
        await expect
          .poll(() =>
            page.evaluate(async (label) => {
              const { __TAURI_INTERNALS__: bridge } = window as unknown as {
                __TAURI_INTERNALS__: { invoke: (command: string) => Promise<string[]> };
              };
              return (await bridge.invoke('plugin:window|get_all_windows')).includes(label);
            }, peerLabel),
          )
          .toBe(false);
      }
      if (resolution === 'original strip') {
        await pointer(page, 'sample', original);
        await expect.poll(() => detached?.isClosed()).toBe(true);
      }
      if (resolution === 'cancelled') await page.keyboard.press('Escape');
      const drop =
        resolution === 'cancelled' ? null : resolution === 'desktop' ? desktop : resolution === 'original strip' ? original : target;
      await pointer(page, 'release', drop);
      await page.mouse.up();

      if (resolution === 'receiving strip') {
        await expect(source.grouped ? group(peer) : draft(peer).getByRole('tab', { selected: true })).toBeVisible();
        await expect.poll(() => visibility(page, label)).toBe(source.remaining ? 'visible' : 'hidden');
        await expect(source.grouped ? group(page) : draft(page)).toHaveCount(0);
        if (detached) await expect.poll(() => detached.isClosed()).toBe(true);
      } else if (resolution === 'desktop' && detached && detachedLabel) {
        await expect.poll(() => visibility(page, detachedLabel)).toBe('visible');
        await expect(source.grouped ? group(detached) : draft(detached).getByRole('tab', { selected: true })).toBeVisible();
        await expect(source.grouped ? group(page) : draft(page)).toHaveCount(0);
        expect(context.pages()).toHaveLength(3);
      } else {
        await expect(first).toBeVisible();
        await expect.poll(() => visibility(page, label)).toBe('visible');
        if (detached) await expect.poll(() => detached.isClosed()).toBe(true);
      }
      if (!peer.isClosed() && resolution !== 'receiving strip') {
        await expect(incoming).toHaveCount(0);
        await expect(areaLabel(peer)).toHaveText('终端会话');
      }
      const owner = resolution === 'receiving strip' ? peer : resolution === 'desktop' && detached ? detached : page;
      await expectDraft(owner, expanded);
    });
  }

type Reply = 'peer-ready' | 'peer-verified' | 'detached-ready';

const replyGate = (page: Page, reply: Reply, action: 'hold' | 'count' | 'release', reject = false) =>
  page.evaluate(
    ({ reply, action, reject }) => {
      const { __WORKSPACE_REPLIES__: gate } = window as unknown as {
        __WORKSPACE_REPLIES__: {
          hold: (reply: Reply) => void;
          count: (reply: Reply) => number;
          release: (reply: Reply, reject: boolean) => void;
        };
      };
      if (action === 'count') return gate.count(reply);
      if (action === 'hold') gate.hold(reply);
      else gate.release(reply, reject);
    },
    { reply, action, reject },
  );

const heldSource = (page: Page, source: Source) =>
  source.grouped ? strip(page).locator('[data-group-header-id]').filter({ hasText: groupTitle }) : draft(page);
const expectRestoredPeer = async (peer: Page, source: Source) => {
  await expect(incomingPreview(peer, source)).toHaveCount(0);
  await expect(areaLabel(peer)).toHaveText('终端会话');
};

const peerTransitions = [
  'switch directly between peers',
  'release on a peer without a final move sample',
  'deliver stale readiness after a burst of visits',
  'lose renderer capture while crossing peers',
  'release while the peer rejects readiness',
  'release before the receiver confirms',
  'recover when the receiver never confirms',
] as const;

for (const source of sources)
  for (const transition of peerTransitions) {
    test(`${source.name} · ${transition}`, async ({ page, context }) => {
      const { expanded } = await prepareSource(page, context, source);
      const first = await openPeer(page);
      const one = await hitTestPoint(first);
      const confirmsLate =
        transition === 'release before the receiver confirms' || transition === 'recover when the receiver never confirms';
      const rejected =
        transition === 'release while the peer rejects readiness' || transition === 'recover when the receiver never confirms';
      const usesSecond = !rejected && !confirmsLate;
      const second = usesSecond ? await openPeer(page) : first;
      const two = usesSecond ? await hitTestPoint(second) : one;
      const original = await startDrag(page, source);
      const label = original.over;
      const gateReady =
        transition === 'deliver stale readiness after a burst of visits' || transition === 'release while the peer rejects readiness';
      if (gateReady) await replyGate(page, 'peer-ready', 'hold');
      if (confirmsLate) await replyGate(page, 'peer-verified', 'hold');

      await pointer(page, 'sample', one);
      await expect(incomingPreview(first, source)).toBeVisible();
      await expect.poll(() => visibility(page, label)).toBe(source.remaining ? 'visible' : 'cloaked');
      if (gateReady) await expect.poll(() => replyGate(page, 'peer-ready', 'count')).toBe(1);
      let destination = second;
      let release = two;
      if (transition === 'switch directly between peers') {
        await pointer(page, 'sample', two);
        await expect(incomingPreview(second, source)).toBeVisible();
        await expectRestoredPeer(first, source);
        await pointer(page, 'sample', one);
        await expect(incomingPreview(first, source)).toBeVisible();
        await expectRestoredPeer(second, source);
        destination = first;
        release = one;
      } else if (transition === 'deliver stale readiness after a burst of visits') {
        await page.evaluate(
          ({ one, two }) => {
            const { __WORKSPACE_DRAG__: drag } = window as unknown as { __WORKSPACE_DRAG__: { sample: (point: Sample) => void } };
            for (const point of [two, one, two, one, two]) drag.sample(point);
          },
          { one, two },
        );
        await expect(incomingPreview(second, source)).toBeVisible();
        await expectRestoredPeer(first, source);
        await expect.poll(async () => (await replyGate(page, 'peer-ready', 'count')) ?? 0).toBeGreaterThanOrEqual(2);
        await replyGate(page, 'peer-ready', 'release');
      } else if (transition === 'lose renderer capture while crossing peers') {
        await page.evaluate(() => window.dispatchEvent(new Event('blur')));
        await pointer(page, 'sample', two);
        await expect(incomingPreview(second, source)).toBeVisible();
        await expectRestoredPeer(first, source);
      }

      await pointer(page, 'release', release);
      await page.mouse.up();
      if (rejected) {
        if (gateReady) await replyGate(page, 'peer-ready', 'release', true);
        else await expect.poll(() => replyGate(page, 'peer-verified', 'count')).toBe(1);
        await expectRestoredPeer(first, source);
        await expect.poll(() => visibility(page, label)).toBe('visible');
        await expectDraft(page, expanded);
        if (confirmsLate) await replyGate(page, 'peer-verified', 'release');
      } else {
        if (confirmsLate) {
          await expect.poll(() => replyGate(page, 'peer-verified', 'count')).toBe(1);
          await expect(heldSource(page, source)).toHaveCount(1);
          await expect(incomingPreview(first, source)).toBeVisible();
          await replyGate(page, 'peer-verified', 'release');
        }
        await expect(heldSource(page, source)).toHaveCount(0);
        await expect.poll(() => visibility(page, label)).toBe(source.remaining ? 'visible' : 'hidden');
        await expectDraft(destination, expanded);
        if (usesSecond) await expectRestoredPeer(destination === second ? first : second, source);
      }
      await expect.poll(() => visibility(page, one.over)).toBe('visible');
      await expect.poll(() => visibility(page, two.over)).toBe('visible');
      expect(context.pages()).toHaveLength(usesSecond ? 3 : 2);
    });
  }

for (const source of sources.filter((source) => !source.grouped)) {
  test(`${source.name} · editing the source invalidates the received preview`, async ({ page, context }) => {
    await prepareSource(page, context, source);
    await draft(page).getByRole('tab').click();
    const peer = await openPeer(page);
    const target = await hitTestPoint(peer);
    const original = await startDrag(page, source);
    await pointer(page, 'sample', target);
    await expect(incomingPreview(peer, source)).toBeVisible();
    const sourceEditor = page.locator('[data-testid="file-editor"]:visible');
    await sourceEditor.locator('textarea.inputarea').focus();
    await page.keyboard.insertText('Latest source edit');
    await expect(sourceEditor.locator('.view-lines')).toContainText('Latest source edit');
    await pointer(page, 'release', target);
    await page.mouse.up();
    await expectRestoredPeer(peer, source);
    await expect.poll(() => visibility(page, original.over)).toBe('visible');
    await expect(draft(page).getByRole('tab')).toHaveAttribute('aria-selected', 'true');
    await expect(sourceEditor.locator('.view-lines')).toContainText('Latest source edit');
    expect(context.pages()).toHaveLength(2);
  });

  test(`${source.name} · a duplicate document keeps both editors and drafts`, async ({ page, context }) => {
    await prepareSource(page, context, source);
    const peer = await openPeer(page);
    const path = '/home/e2e/shared-document.txt';
    const tab = (owner: Page) => strip(owner).getByRole('tab', { name: /^shared-document\.txt/ });
    const editorText = (owner: Page) => owner.locator('[data-testid="file-editor"]:visible .view-lines');
    for (const [owner, text] of [
      [page, 'Source modified text'],
      [peer, 'Destination modified text'],
    ] as const) {
      await selectArea(owner, 'code');
      await owner.evaluate((path) => {
        (window as unknown as { __PICK_PATHS__: string[] }).__PICK_PATHS__ = [path];
      }, path);
      await strip(owner).getByRole('button', { name: '打开文件', exact: true }).click();
      await expect(tab(owner)).toHaveAttribute('aria-selected', 'true');
      await owner.locator('[data-testid="file-editor"]:visible textarea.inputarea').focus();
      await owner.keyboard.press('Control+a');
      await owner.keyboard.insertText(text);
      await expect(editorText(owner)).toContainText(text);
    }
    await strip(page).getByRole('button', { name: '关闭文件 未命名 1.txt', exact: true }).click();
    await page.getByRole('button', { name: '放弃并关闭', exact: true }).click();
    const one = await hitTestPoint(peer);
    const original = await startDrag(page, source, tab(page));
    await pointer(page, 'sample', one);
    await pointer(page, 'release', one);
    await page.mouse.up();
    await expect(page.getByText('无法更新工作区', { exact: true })).toBeVisible();
    await expect.poll(() => visibility(page, original.over)).toBe('visible');
    await expect(tab(page)).toHaveCount(1);
    await expect(tab(peer)).toHaveCount(1);
    await expect(editorText(page)).toContainText('Source modified text');
    await expect(editorText(peer)).toContainText('Destination modified text');
    expect(context.pages()).toHaveLength(2);
  });
}

for (const source of sources.filter((source) => source.remaining))
  for (const transition of ['return before ready', 'release before ready', 'dock while still loading'] as const) {
    test(`${source.name} · ${transition} with a detached window`, async ({ page, context }) => {
      const { expanded } = await prepareSource(page, context, source);
      const peer = transition === 'dock while still loading' ? await openPeer(page) : undefined;
      const original = await startDrag(page, source);
      await replyGate(page, 'detached-ready', 'hold');
      const opened = page.waitForEvent('popup');
      await pointer(page, 'sample', desktop);
      const detached = await opened;
      const label = await readLabel(detached);
      await expect.poll(() => replyGate(page, 'detached-ready', 'count')).toBe(1);
      await expect.poll(() => visibility(page, label)).toBe('hidden');
      if (transition === 'return before ready') {
        await pointer(page, 'sample', original);
        await expect.poll(() => detached.isClosed()).toBe(true);
        await replyGate(page, 'detached-ready', 'release');
        await pointer(page, 'release', original);
        await page.mouse.up();
        await expectDraft(page, expanded);
        expect(context.pages()).toHaveLength(1);
      } else {
        if (peer) {
          await pointer(page, 'sample', await hitTestPoint(peer));
          await expect(incomingPreview(peer, source)).toBeVisible();
          await replyGate(page, 'detached-ready', 'release');
          await expect.poll(() => visibility(page, label)).toBe('hidden');
          await pointer(page, 'sample', desktop);
          await expectRestoredPeer(peer, source);
          await expect.poll(() => visibility(page, label)).toBe('visible');
        }
        await pointer(page, 'release', desktop);
        await page.mouse.up();
        if (!peer) {
          await expect(heldSource(page, source)).toHaveCount(1);
          await expect.poll(() => visibility(page, label)).toBe('hidden');
          await replyGate(page, 'detached-ready', 'release');
        }
        await expect.poll(() => visibility(page, label)).toBe('visible');
        await expect(heldSource(page, source)).toHaveCount(0);
        await expectDraft(detached, expanded);
        expect(context.pages()).toHaveLength(peer ? 3 : 2);
      }
      await expect.poll(() => visibility(page, original.over)).toBe('visible');
    });
  }

for (const source of sources.filter((source) => source.remaining)) {
  test(`${source.name} · a visible detached window disappears before release`, async ({ page, context }) => {
    const { expanded } = await prepareSource(page, context, source);
    const original = await startDrag(page, source);
    const opened = page.waitForEvent('popup');
    await pointer(page, 'sample', desktop);
    const detached = await opened;
    const label = await readLabel(detached);
    await expect.poll(() => visibility(page, label)).toBe('visible');
    await detached.close();
    await expect
      .poll(() =>
        page.evaluate((label) => {
          const { __TAURI_INTERNALS__: bridge } = window as unknown as {
            __TAURI_INTERNALS__: { invoke: (command: string, args: { label: string }) => Promise<boolean> };
          };
          return bridge.invoke('plugin:window|is_visible', { label });
        }, label),
      )
      .toBe(false);
    await pointer(page, 'release', desktop);
    await page.mouse.up();
    await expect(page.getByText('无法更新工作区', { exact: true })).toBeVisible();
    await expect.poll(() => visibility(page, original.over)).toBe('visible');
    await expectDraft(page, expanded);
    expect(context.pages()).toHaveLength(1);
  });
}

for (const source of sources.filter((source) => source.remaining))
  for (const direction of [-1, 1] as const) {
    test(`${source.name} · diagonal drag ${direction < 0 ? 'left' : 'right'} hides its row after capture loss`, async ({
      page,
      context,
    }) => {
      const { expanded } = await prepareSource(page, context, source);
      const original = await startDrag(page, source);
      const { x, y } = original.client!;
      const diagonal = { x: x + 100 + direction * 96, y: y + 220, over: '' };
      const opened = page.waitForEvent('popup');
      await pointer(page, 'sample', diagonal);
      await page.mouse.move(x + direction * 96, y + 120, { steps: 6 });
      const detached = await opened;
      const label = await readLabel(detached);
      await expect.poll(() => visibility(page, label)).toBe('visible');
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await expect(heldSource(detached, source)).toBeVisible();
      const sourceRow = heldSource(page, source);
      await expect(sourceRow).toHaveCount(1);
      await expect(sourceRow).toBeHidden();
      await expect.poll(() => visibility(page, original.over)).toBe('visible');

      if (direction < 0) {
        await pointer(page, 'sample', original);
        await expect(page.locator('[data-reorder-preview="item"]')).toBeVisible();
      }
      await pointer(page, 'release', direction < 0 ? original : null);
      await page.mouse.up();
      await expect.poll(() => detached.isClosed()).toBe(true);
      await expectDraft(page, expanded);
      expect(context.pages()).toHaveLength(1);
    });
  }
