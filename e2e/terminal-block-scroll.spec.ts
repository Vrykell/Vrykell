import { expect, test } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test('command headings scroll with their blocks and leave the top of history clear', async ({ page }, info) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await page.evaluate(() => {
    const scope = window as unknown as {
      __vrykellSessionRegistry: {
        controllers: Map<string, { seed(blocks: import('../src/features/terminal/services/pipeline/termBlock').TermBlock[]): void }>;
      };
    };
    const controller = [...scope.__vrykellSessionRegistry.controllers.values()][0]!;
    controller.seed(
      [0, 1].map((index) => ({
        id: `scroll-${index}`,
        command: `ls directory-${index}`,
        cwd: `/work/directory-${index}`,
        status: 'done',
        exitCode: index,
        startedAt: 1000,
        endedAt: 1182,
        wasLongRunning: false,
        linesTruncated: 0,
        outputText: Array.from({ length: 80 }, (_, row) => `file-${index}-${row}`).join('\n'),
        outputHtml: '',
        outputRaw: '',
      })),
    );
  });
  const scroll = page.locator('[data-testid^="terminal-scroll-"]').first();
  for (const index of [0, 1]) {
    const block = page.getByTestId(`command-block-scroll-${index}`);
    const command = block.locator('.command-block-command');
    await expect(command).toHaveText(`ls directory-${index}`);
    await expect(block.locator('.command-block-cwd')).toHaveText(`/work/directory-${index}`);
    await command.scrollIntoViewIfNeeded();
    await expect(command).toBeInViewport();
    await scroll.evaluate((element, id) => {
      const heading = element.querySelector(`[data-testid="${id}"] .command-block-command`)!;
      element.scrollTop += heading.getBoundingClientRect().bottom - element.getBoundingClientRect().top + 80;
    }, `command-block-scroll-${index}`);
    await expect(command).not.toBeInViewport();
    await expect(page.getByTestId('pinned-command')).toHaveCount(0);
    expect(
      await scroll.evaluate((element) => {
        const { left, top } = element.getBoundingClientRect();
        return document
          .elementFromPoint(left + 80, top + 20)
          ?.closest('[data-command-block-id]')
          ?.getAttribute('data-command-block-id');
      }),
    ).toBe(`scroll-${index}`);
  }
  await page.screenshot({ path: info.outputPath('terminal-history-without-overlay.png') });
});
