import { expect, test, type Page } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

async function pinCommandTitle(page: Page) {
  await page.getByPlaceholder(/输入命令/).fill('echo divider');
  await page.getByPlaceholder(/输入命令/).press('Enter');
  await page.evaluate(() => {
    const scope = window as unknown as {
      __vrykellSessionRegistry: {
        controllers: Map<string, { seed(blocks: import('../src/features/terminal/services/pipeline/termBlock').TermBlock[]): void }>;
      };
    };
    [...scope.__vrykellSessionRegistry.controllers.values()][0]!.seed([
      {
        id: 'divider-output',
        command: 'echo divider',
        cwd: '/work',
        status: 'done',
        exitCode: 0,
        startedAt: 1000,
        endedAt: 1200,
        wasLongRunning: false,
        linesTruncated: 0,
        outputText: 'divider output\n'.repeat(100),
        outputHtml: '',
        outputRaw: '',
      },
    ]);
  });
  await page
    .locator('[data-testid^="terminal-scroll-"]')
    .first()
    .evaluate((element) => {
      element.scrollTop = 140;
    });
  await expect(page.getByTestId('pinned-command')).toBeVisible();
}

async function expectUniformDrag(page: Page, mode: string, width: number, colorTolerance = 12) {
  for (const id of ['files', 'chat']) {
    if (!(await page.getByTestId(`resize-handle-${id}`).isVisible())) await page.locator(`[data-dock-btn="${id}"]`).click();
    const handle = page.getByTestId(`resize-handle-${id}`);
    const bounds = (await handle.boundingBox())!;
    const grabX = bounds.x + bounds.width / 2 + 2;
    const panelWidth = (await handle.locator('..').boundingBox())!.width;
    await page.mouse.move(grabX, bounds.y + 20);
    await page.mouse.down();
    await page.mouse.move(grabX - 35, bounds.y + 150, { steps: 4 });
    const dragBounds = (await handle.boundingBox())!;
    expect((await handle.locator('..').boundingBox())!.width).toBe(panelWidth + 35);
    const line = handle.locator('[data-resize-line]');
    await expect.poll(() => line.evaluate((element) => (element as HTMLElement).style.backgroundColor)).toBe('var(--border-strong)');
    const color = await line.evaluate((element) => getComputedStyle(element).backgroundColor);
    const lineBounds = (await line.boundingBox())!;
    const png = await page.screenshot({ path: test.info().outputPath(`${mode}-${id}-${width}-divider.png`), animations: 'disabled' });
    const candidates = await page.evaluate(
      async ({ png, bounds, lineBounds }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${png}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        return [20, 120, bounds.height / 2, bounds.height - 30].map((offset) => {
          // The divider is one CSS pixel wide and blends across two device pixels at fractional
          // scales, so return its whole span and let the caller pick the covered pixel.
          const y = Math.floor((bounds.y + offset) * devicePixelRatio);
          const span: number[][] = [];
          for (
            let x = Math.floor(lineBounds.x * devicePixelRatio) - 1;
            x <= Math.ceil((lineBounds.x + lineBounds.width) * devicePixelRatio);
            x++
          ) {
            const [r, g, b] = context.getImageData(x, y, 1, 1).data;
            span.push([r, g, b]);
          }
          return span;
        });
      },
      { png: png.toString('base64'), bounds: dragBounds, lineBounds },
    );
    const expected = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number);
    const channelDrift = (sample: number[], reference: number[]) =>
      Math.max(...sample.map((channel, index) => Math.abs(channel - reference[index])));
    // A neighbouring surface can be brighter than the divider, so pick the pixel closest to the
    // expected colour instead of the brightest one.
    const samples = candidates.map((span) =>
      span.reduce((best, candidate) => (channelDrift(candidate, expected) < channelDrift(best, expected) ? candidate : best)),
    );
    const [first, ...rest] = samples;
    expect(channelDrift(first, expected), `${mode} ${id} at ${width}`).toBeLessThanOrEqual(colorTolerance);
    for (const sample of rest) {
      expect(channelDrift(sample, first), `${mode} ${id} at ${width}`).toBeLessThanOrEqual(8);
    }
    expect(
      await handle.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return [20, 120].every((offset) => element.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + offset)));
      }),
    ).toBe(true);
    await page.mouse.move(grabX, bounds.y + 150);
    await page.mouse.up();
  }
}

for (const density of [1, 1.25, 1.5, 2]) {
  test.describe(`sidebar dividers at ${density}x`, () => {
    test.use({ deviceScaleFactor: density });
    test('held sidebar drag stays uniform beside pinned titles, editors and comparisons', async ({ page }) => {
      test.setTimeout(60_000);
      await setupTauriMock(page, {});
      await page.goto('/');
      await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
      await page.locator('[data-dock-btn="chat"]').click();
      await pinCommandTitle(page);
      for (const mode of ['terminal', 'editor', 'diff']) {
        await page.setViewportSize({ width: 1240, height: 800 });
        if (!(await page.getByTestId('resize-handle-chat').isVisible())) await page.locator('[data-dock-btn="chat"]').click();
        if (mode !== 'terminal') {
          await page.locator('[data-dock-btn="git"]').click();
          const row = page.getByTestId('git-unstaged-src/main.ts');
          if (mode === 'editor') {
            await row.hover();
            await row.getByRole('button', { name: '打开工作文件' }).click();
            await expect(page.getByTestId('file-editor').locator('.monaco-editor')).toBeVisible();
          } else {
            await row.click();
            await expect(page.getByTestId('git-diff-review').locator('.monaco-diff-editor')).toBeVisible();
          }
          await page.locator('[data-dock-btn="chat"]').click();
        }
        for (const width of [1240, 960]) {
          await page.setViewportSize({ width, height: 800 });
          // A one-pixel hairline at a fractional device scale always covers two pixels partially,
          // so its blend with the neighbouring surface can drift further than at 1x or 2x. The
          // token itself is asserted on the element style above; this check keeps the drag uniform.
          await expectUniformDrag(page, mode, width, density % 1 === 0 ? 12 : 20);
        }
      }
    });
  });
}
