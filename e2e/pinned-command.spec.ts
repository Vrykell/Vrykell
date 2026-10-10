import { test, expect } from '@playwright/test';
import { setupTauriMock } from './tauri-mock';

test('viewport command follows history, collapses independently and keeps hover colors stable', async ({ page }) => {
  await setupTauriMock(page); await page.goto('/');
  const input = page.getByPlaceholder(/输入命令/);
  await input.fill('echo ready'); await input.press('Enter');
  await expect(page.locator('.command-block-command').filter({ hasText: 'echo ready' })).toBeVisible();
  await page.evaluate(async () => {
    const scope = window as unknown as { __vrykellSessionRegistry: { controllers: Map<string, { seed(blocks: import('../src/features/terminal/services/pipeline/termBlock').TermBlock[]): void }> } };
    const controller = [...scope.__vrykellSessionRegistry.controllers.values()][0]!;
    controller.seed(Array.from({ length: 3 }, (_, index) => ({
      id: `sticky-${index}`, command: `ls directory-${index}`, cwd: `/work/directory-${index}`,
      status: 'done' as const, exitCode: index === 1 ? 1 : 0,
      startedAt: 1000, endedAt: 1182, wasLongRunning: false, linesTruncated: 0,
      outputText: Array.from({ length: 80 }, (_, row) => `file-${index}-${row}`).join('\n'),
      outputHtml: '', outputRaw: '',
    })));
  });
  const scroll = page.locator('[data-testid^="terminal-scroll-"]').first();
  const pinned = page.getByTestId('pinned-command');
  const move = async (id: string, inset: number) => {
    await scroll.evaluate((element, args) => {
      const item = element.querySelector<HTMLElement>(`[data-command-block-id="${args.id}"]`)!;
      element.scrollTop += item.getBoundingClientRect().top - element.getBoundingClientRect().top + args.inset;
    }, { id, inset });
  };
  await move('sticky-0', 0);
  await expect(pinned).toHaveCount(0);
  await move('sticky-0', 140);
  await expect(pinned).toContainText('/work/directory-0');
  await expect(pinned.locator('.command-block-command')).toHaveText('ls directory-0');
  const box = (await pinned.boundingBox())!;
  const viewport = (await scroll.boundingBox())!;
  expect(Math.abs(box.y - viewport.y)).toBeLessThan(1);
  const hide = pinned.getByRole('button', { name: '收起命令标题' });
  const background = await pinned.evaluate(element => getComputedStyle(element).backgroundColor);
  await page.mouse.move(viewport.x + viewport.width - 30, viewport.y + 150);
  await expect(hide).toHaveCSS('opacity', '0');
  await pinned.hover();
  await expect(hide).toHaveCSS('opacity', '1');
  await expect(pinned).toHaveCSS('background-color', background);
  const beforeWheel = await scroll.evaluate(element => element.scrollTop);
  await page.mouse.wheel(0, 40);
  await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(beforeWheel);
  const top = await scroll.evaluate(element => element.scrollTop);
  await hide.click();
  await expect(pinned).toHaveAttribute('data-collapsed', 'true');
  expect(await scroll.evaluate(element => element.scrollTop)).toBe(top);
  await expect(page.getByTestId('command-block-sticky-0')).toContainText('file-0-79');
  await pinned.getByRole('button', { name: '显示命令标题' }).click();
  await expect(pinned).toHaveAttribute('data-collapsed', 'false');
  await hide.click();
  await move('sticky-1', 140);
  await expect(pinned).toContainText('/work/directory-1');
  await expect(pinned).toHaveAttribute('data-collapsed', 'false');
  await expect(pinned).toHaveAttribute('data-failed', 'true');
  await pinned.hover();
  await pinned.getByRole('button', { name: '更多操作' }).click();
  await expect(page.getByRole('menu', { name: '命令块操作' })).toContainText('复制输出');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: test.info().outputPath('pinned-command.png') });
  await move('sticky-2', 140);
  await expect(pinned).toContainText('/work/directory-2');
  await move('sticky-1', 0);
  await expect(pinned).toHaveCount(0);
  await scroll.evaluate(element => { element.scrollTop = 0; });
  await expect(pinned).toHaveCount(0);
});
