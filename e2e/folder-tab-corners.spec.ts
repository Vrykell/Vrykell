import { expect, test, type Locator, type Page } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

async function expectJoinedCorners(page: Page, pane: Locator, path: string) {
  await expect(pane).toBeVisible();
  const header = page.getByTestId('workspace-instance-bar').locator('.folder-header');
  const active = header.locator('.folder-tab[data-active="true"]');
  await expect(active).toBeVisible();
  await page.mouse.move(0, 0);
  const bounds = (await active.boundingBox())!;
  const colors = await header.evaluate(element => ({
    surface: getComputedStyle(element).backgroundColor,
    canvas: getComputedStyle(element.querySelector('.folder-tab[data-active="true"]')!).backgroundColor,
  }));
  const screenshot = await page.screenshot({ path, animations: 'disabled' });
  const pixels = await page.evaluate(async ({ png, bounds, colors }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const colorAt = (x: number, y: number) => Array.from(context.getImageData(
      Math.floor(x * devicePixelRatio), Math.floor(y * devicePixelRatio), 1, 1,
    ).data);
    const bottom = bounds.y + bounds.height;
    const joins = [bounds.x - 1, bounds.x + bounds.width].map(x => colorAt(x, bottom - 1));
    const cutouts = [bounds.x - 4, bounds.x + bounds.width + 3].map(x => colorAt(x, bottom - 8));
    const normalize = (color: string) => {
      context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    };
    return { joins, cutouts, canvas: normalize(colors.canvas), surface: normalize(colors.surface) };
  }, { png: screenshot.toString('base64'), bounds, colors });
  expect(pixels.canvas).not.toEqual(pixels.surface);
  expect(pixels.joins).toEqual([pixels.canvas, pixels.canvas]);
  expect(pixels.cutouts).toEqual([pixels.surface, pixels.surface]);
}

for (const density of [1, 1.25, 2]) {
  for (const mode of ['dark', 'light']) {
    test.describe(`folder tab corners in ${mode} mode at ${density}x density`, () => {
      test.use({ deviceScaleFactor: density });

      test('file and comparison tabs join the content without gaps or square protrusions', async ({ page }, info) => {
        test.setTimeout(60_000);
        await setupTauriMock(page.context(), { launchDirectory: '/home/e2e/project', terminalDirectories: true });
        await page.addInitScript(mode => localStorage.setItem('vrykell-theme-mode', mode), mode);
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
        await page.getByRole('button', { name: '版本控制', exact: true }).click();
        const row = page.getByTestId('git-unstaged-src/main.ts');
        await row.hover(); await row.getByRole('button', { name: '打开工作文件' }).click();
        const editor = page.getByTestId('file-editor');
        const strip = page.getByTestId('workspace-instance-bar');
        await expect(editor.locator('.monaco-editor')).toBeVisible({ timeout: 15_000 });
        expect(await strip.locator('.folder-tab').first().evaluate(element => getComputedStyle(element, '::before').content)).toBe('""');
        await expectJoinedCorners(page, editor, info.outputPath('editor-first-tab-corners.png'));
        const more = strip.getByRole('button', { name: '全部工作区标签', exact: true });
        const selectedColor = await more.evaluate(element => { const probe = document.createElement('span'); probe.style.backgroundColor = 'var(--tab-menu-bg)'; element.append(probe); const color = getComputedStyle(probe).backgroundColor; probe.remove(); return color; });
        await expect(more).toHaveCSS('background-color', selectedColor);
        expect((await more.boundingBox())!.x + (await more.boundingBox())!.width).toBeLessThan((await strip.locator('.folder-tab').first().boundingBox())!.x);
        await more.hover(); await expect(more).toHaveCSS('background-color', selectedColor);
        await more.click(); await expect(more).toHaveCSS('background-color', selectedColor);
        await expect(more.locator('svg')).toHaveCSS('transform', 'matrix(-1, 0, 0, -1, 0, 0)');
        await more.click();
        await expect(more).toHaveAttribute('aria-expanded', 'false');
        await expect(more.locator('svg')).toHaveCSS('transform', 'none');
        await more.click();
        await page.keyboard.press('Escape');
        await expect(more.locator('svg')).toHaveCSS('transform', 'none');
        const secondFile = page.getByTestId('git-untracked-new file.ts');
        await secondFile.hover(); await secondFile.getByRole('button', { name: '打开工作文件' }).click();
        for (const width of [1240, 760]) {
          await page.setViewportSize({ width, height: 800 });
          await expectJoinedCorners(page, editor, info.outputPath(`editor-corners-${width}.png`));
        }
        await page.setViewportSize({ width: 1240, height: 800 });
        await row.click();
        await page.getByTestId('git-staged-src/main.ts').click();
        const review = page.getByTestId('git-diff-review');
        await expect(review.locator('.monaco-diff-editor')).toBeVisible({ timeout: 15_000 });
        await expect(strip.getByRole('button', { name: '全部工作区标签', exact: true })).toHaveCSS('background-color', selectedColor);
        for (const width of [1240, 760]) {
          await page.setViewportSize({ width, height: 800 });
          await expectJoinedCorners(page, review, info.outputPath(`comparison-corners-${width}.png`));
        }
      });
    });
  }
}
