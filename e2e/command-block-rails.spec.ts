import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

for (const scale of [1, 2]) {
  test.describe(`error rails at ${scale}x pixel density`, () => {
    test.use({ deviceScaleFactor: scale });

    test('adjacent failures have a continuous rail across dividers, ending before success', async ({ page }) => {
      await setupTauriMock(page);
      await page.goto('/');
      await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
      await page.waitForFunction(async () => {
        const path = '/src/features/terminal/stores/terminal.ts';
        const { useTerminalStore } = await import(path) as typeof import('../src/features/terminal/stores/terminal');
        return Object.values(useTerminalStore.getState().startupStates).includes('ready');
      });
      await page.evaluate(async () => {
        const terminalPath = '/src/features/terminal/stores/terminal.ts';
        const { useTerminalStore } = await import(terminalPath) as typeof import('../src/features/terminal/stores/terminal');
        const pane = Object.keys(useTerminalStore.getState().sessions)[0]!;
        const scope = window as unknown as { __vrykellSessionRegistry: {
          controllers: Map<string, import('../src/features/terminal/services/pipeline/sessionController').SessionController>;
        } };
        scope.__vrykellSessionRegistry.controllers.get(pane)!.seed([127, 127, 127, 0].map((exitCode, index) => ({
          id: `rail-${index}`, command: exitCode ? 'l' : 'pwd', cwd: '~', status: 'done', exitCode,
          startedAt: 0, endedAt: 50, wasLongRunning: false, outputRaw: '', outputHtml: '',
          outputText: exitCode ? 'bash: l: command not found' : '/Users/example', linesTruncated: 0,
        })));
      });
      await page.mouse.move(0, 0);
      const flow = page.locator('[data-testid^="terminal-flow-"]').first();
      const first = page.getByTestId('command-block-rail-0');
      const lastFailure = page.getByTestId('command-block-rail-2');
      const success = page.getByTestId('command-block-rail-3');
      await expect(success).toBeVisible();
      const flowBounds = (await flow.boundingBox())!;
      const firstBounds = (await first.boundingBox())!;
      const lastBounds = (await lastFailure.boundingBox())!;
      const successBounds = (await success.boundingBox())!;
      const paintedTop = await first.evaluate(element => {
        const main = element.closest('main')!;
        return Math.max(element.getBoundingClientRect().top, main.getBoundingClientRect().top + parseFloat(getComputedStyle(main).borderTopLeftRadius));
      });
      expect(lastBounds.y + lastBounds.height).toBe(successBounds.y);
      const errorColor = await first.evaluate(element => getComputedStyle(element).getPropertyValue('--status-error').trim());
      const screenshot = await flow.screenshot({ path: test.info().outputPath('continuous-error-rails.png') });
      const pixels = await page.evaluate(async ({ png, density, x, top, bottom, successY, errorColor }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${png}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        const column = context.getImageData(Math.floor(x * density), 0, 1, image.height).data;
        const colorAt = (y: number) => Array.from(column.slice(y * 4, y * 4 + 4)).join(',');
        const rail = colorAt(Math.round((top + 8) * density));
        const seams: number[] = [];
        for (let y = Math.round(top * density); y < Math.round(bottom * density); y++) {
          if (colorAt(y) !== rail) seams.push(y);
        }
        const success = colorAt(Math.round(successY * density));
        context.fillStyle = errorColor;
        context.fillRect(0, 0, 1, 1);
        const expected = Array.from(context.getImageData(0, 0, 1, 1).data).join(',');
        return { seams, rail, success, expected };
      }, {
        png: screenshot.toString('base64'), density: scale, errorColor,
        x: firstBounds.x - flowBounds.x + 1.5,
        top: paintedTop - flowBounds.y,
        bottom: lastBounds.y + lastBounds.height - flowBounds.y,
        successY: successBounds.y + successBounds.height / 2 - flowBounds.y,
      });
      expect(pixels.seams).toEqual([]);
      expect(pixels.rail).toBe(pixels.expected);
      expect(pixels.success).not.toBe(pixels.rail);
    });
  });
}
