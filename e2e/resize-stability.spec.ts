import { expect, test } from '@playwright/test';
import { emitPtyOutput, ptyResizes, setupTauriMock } from './tauri-mock';

for (const renderer of ['dom', 'webgl']) {
  test(`classic ${renderer} keeps its text origin stable through continuous resizing`, async ({ page }) => {
    await setupTauriMock(page, { integration: false });
    await page.addInitScript(renderer => {
      localStorage.setItem('vrykell-agent-settings', JSON.stringify({ version: 8,
        state: { global: { openModeByShell: { zsh: 'classic' } }, overrides: {} } }));
      localStorage.setItem('vrykell-typography', JSON.stringify({ state: { terminalRenderer: renderer } }));
    }, renderer);
    await page.goto('/');
    const screen = page.locator('.xterm-screen').first();
    await expect(screen).toBeVisible();
    await emitPtyOutput(page, 'stable-resize-text\r\n'.repeat(15));
    const measurements = [];
    for (let width = 1240; width >= 800; width -= 20) {
      await page.setViewportSize({ width, height: 800 });
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      measurements.push(await screen.evaluate(element => {
        const host = element.closest('.terminal-pane')!;
        return { offset: element.getBoundingClientRect().left - host.getBoundingClientRect().left,
          width: element.getBoundingClientRect().width,
          sidebar: document.querySelector('[data-testid="workspace-sidebar"]')!.getBoundingClientRect().width };
      }));
    }
    expect(Math.max(...measurements.map(item => item.offset)) - Math.min(...measurements.map(item => item.offset))).toBeLessThanOrEqual(.5);
    for (let index = 1; index < measurements.length; index++) expect(measurements[index]!.width + measurements[index]!.sidebar).toBeLessThanOrEqual(measurements[index - 1]!.width + measurements[index - 1]!.sidebar);
    const resizes = await ptyResizes(page);
    for (let index = 1; index < resizes.length; index++) expect(resizes[index]).not.toEqual(resizes[index - 1]);
    await page.screenshot({ path: test.info().outputPath(`resize-${renderer}.png`), animations: 'disabled' });
  });
}

test('a held divider drag keeps the local grid live and notifies the remote once, on release', async ({ page }) => {
  await setupTauriMock(page);
  await page.addInitScript(() => {
    localStorage.setItem('vrykell-agent-settings', JSON.stringify({ version: 8, state: { global: { openModeByShell: { zsh: 'classic' } }, overrides: {} } }));
  });
  await page.goto('/');
  const screen = page.locator('.xterm-screen').first();
  await expect(screen).toBeVisible();
  const handleLocator = page.getByTestId('resize-handle-files');
  await page.locator('[data-dock-btn="files"]').click();
  await expect(handleLocator).toBeVisible();
  const handle = (await handleLocator.boundingBox())!;
  const widthBefore = (await screen.boundingBox())!.width;
  await page.waitForTimeout(200);
  let resizesBefore = (await ptyResizes(page)).length;
  for (let attempt = 0; attempt < 10; attempt++) {
    await page.waitForTimeout(50);
    const next = (await ptyResizes(page)).length;
    if (next === resizesBefore) break;
    resizesBefore = next;
  }
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 140);
  await page.mouse.down();
  for (const delta of [20, 40, 60, 80]) {
    await page.mouse.move(handle.x + handle.width / 2 - delta, handle.y + 140, { steps: 3 });
    await page.waitForTimeout(50);
  }
  // The local grid follows the pointer live; nothing has reached the remote PTY yet.
  await expect.poll(async () => (await screen.boundingBox())!.width).toBeLessThan(widthBefore);
  expect((await ptyResizes(page)).length).toBe(resizesBefore);
  await page.mouse.up();
  // Releasing the drag delivers exactly the final size once.
  await expect.poll(async () => (await ptyResizes(page)).length).toBe(resizesBefore + 1);
});

test('short commands complete without mounting a temporary live output canvas', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await page.evaluate(() => {
    const scope = window as unknown as { __temporaryCanvases: number };
    scope.__temporaryCanvases = 0;
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof Element && (node.matches('[data-testid="running-term"]') || node.querySelector('[data-testid="running-term"]'))) scope.__temporaryCanvases++;
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  for (let index = 0; index < 5; index++) {
    await emitPtyOutput(page, `\x1b]133;E;${btoa('ls')}\x07\x1b]133;C\x07Documents\r\n\x1b]133;D;0\x07\x1b]133;A\x07`);
    await expect(page.locator('[data-testid^="command-block-"]')).toHaveCount(index + 1);
  }
  await expect(page.locator('[data-testid^="command-block-"]').last()).toContainText('Documents');
  expect(await page.evaluate(() => (window as unknown as { __temporaryCanvases: number }).__temporaryCanvases)).toBe(0);
});
