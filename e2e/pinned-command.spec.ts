import { test, expect } from '@playwright/test';
import { setupTauriMock, emitPtyOutput } from './tauri-mock';

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
  const show = pinned.getByRole('button', { name: '显示命令标题' });
  await page.mouse.move(viewport.x + 40, viewport.y + 150);
  await expect(show).toHaveCSS('opacity', '0');
  await expect(pinned).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await move('sticky-1', 140);
  await expect(pinned).toHaveAttribute('data-collapsed', 'true');
  await expect(pinned.locator('.command-block-command')).toHaveCount(0);
  await expect(show).toHaveCSS('opacity', '0');
  await scroll.evaluate(element => { element.scrollTop = 0; });
  await expect(pinned).toHaveCount(0);
  await move('sticky-1', 140);
  await expect(pinned).toHaveAttribute('data-collapsed', 'true');
  // The collapsed strip reveals the toggle outside the sidebar's drag area, including its far edge.
  const collapsedBox = (await pinned.boundingBox())!;
  for (const offset of [6, 12, collapsedBox.width / 2, collapsedBox.width - 2]) {
    await page.mouse.move(collapsedBox.x + offset, collapsedBox.y + 12);
    await expect(show).toHaveCSS('opacity', '1');
    expect(await pinned.evaluate((element, x) => {
      const rect = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(rect.x + x, rect.y + 12));
    }, offset)).toBe(true);
    expect(await page.getByTestId('command-block-sticky-1').evaluate(element => element.matches(':hover'))).toBe(false);
  }
  await expect(show).toHaveCSS('opacity', '1');
  await expect(show).toHaveCSS('border-radius', '999px');
  await expect(show).toHaveCSS('width', '32px');
  await expect(show).toHaveCSS('height', '20px');
  await show.hover();
  expect(await show.evaluate(element => getComputedStyle(element).backgroundColor)).toMatch(/^rgb\(/);
  await page.screenshot({ path: test.info().outputPath('restore-command-hover.png') });
  await show.click();
  await expect(pinned).toHaveAttribute('data-collapsed', 'false');
  await expect(pinned).toContainText('/work/directory-1');
  await expect(pinned).toHaveAttribute('data-failed', 'true');
  // The header divider must not cut the failure rail: it is painted beneath the rail,
  // not drawn as a border that ends the rail one pixel early.
  const railMetrics = await pinned.evaluate(element => ({
    border: getComputedStyle(element).borderBottomWidth,
    divider: getComputedStyle(element, '::after').height,
    railZ: getComputedStyle(element, '::before').zIndex,
  }));
  expect(railMetrics.border).toBe('0px');
  expect(railMetrics.divider).toBe('1px');
  expect(railMetrics.railZ).toBe('1');
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

test('remembers the collapsed viewport title across launches', async ({ page }) => {
  await setupTauriMock(page); await page.goto('/');
  const input = page.getByPlaceholder(/输入命令/);
  const seed = async () => page.evaluate(async () => {
    const scope = window as unknown as { __vrykellSessionRegistry: { controllers: Map<string, { seed(blocks: import('../src/features/terminal/services/pipeline/termBlock').TermBlock[]): void }> } };
    const controller = [...scope.__vrykellSessionRegistry.controllers.values()][0]!;
    controller.seed([{
      id: 'sticky-0', command: 'ls directory-0', cwd: '/work/directory-0', status: 'done' as const, exitCode: 0,
      startedAt: 1000, endedAt: 1182, wasLongRunning: false, linesTruncated: 0,
      outputText: Array.from({ length: 80 }, (_, row) => `file-${row}`).join('\n'), outputHtml: '', outputRaw: '',
    }]);
  });
  const scroll = page.locator('[data-testid^="terminal-scroll-"]').first();
  const pinned = page.getByTestId('pinned-command');
  const revealTitle = async () => {
    await input.fill('echo ready'); await input.press('Enter');
    await expect(page.locator('.command-block-command').filter({ hasText: 'echo ready' })).toBeVisible();
    await seed();
    await scroll.evaluate(element => {
      const item = element.querySelector<HTMLElement>('[data-command-block-id="sticky-0"]')!;
      element.scrollTop += item.getBoundingClientRect().top - element.getBoundingClientRect().top + 140;
    });
  };
  await revealTitle();
  await expect(pinned).toContainText('ls directory-0');
  await pinned.hover();
  await pinned.getByRole('button', { name: '收起命令标题' }).click();
  await expect(pinned).toHaveAttribute('data-collapsed', 'true');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('vrykell-typography') ?? '{}').state.commandTitleCollapsed)).toBe(true);
  await page.reload();
  await expect.poll(() => page.evaluate(async () => {
    const { useTypographyStore } = await import('/src/config/typography.ts') as typeof import('../src/config/typography');
    return useTypographyStore.getState().commandTitleCollapsed;
  })).toBe(true);
  await revealTitle();
  await expect(pinned).toHaveAttribute('data-collapsed', 'true');
  await expect(pinned.locator('.command-block-command')).toHaveCount(0);
});

test('collapsed titles never flash while scrolling across history and live output', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.locator('[data-terminal-input]:visible')).toBeVisible();
  await page.evaluate(async () => {
    const scope = window as unknown as { __vrykellSessionRegistry: { controllers: Map<string, { seed(blocks: import('../src/features/terminal/services/pipeline/termBlock').TermBlock[]): void }> } };
    [...scope.__vrykellSessionRegistry.controllers.values()][0]!.seed(Array.from({ length: 3 }, (_, index) => ({
      id: `stable-${index}`, command: `hidden-history-${index}`, cwd: `/work/history-${index}`,
      status: 'done' as const, exitCode: 0, startedAt: 1000, endedAt: 1200,
      wasLongRunning: false, linesTruncated: 0, outputHtml: '', outputRaw: '',
      outputText: Array.from({ length: 80 }, (_, row) => `entry-${row}`).join('\n'),
    })));
  });
  const scroll = page.locator('[data-testid^="terminal-scroll-"]').first();
  const pinned = page.getByTestId('pinned-command');
  const move = async (index: number) => scroll.evaluate((element, id) => {
    const item = element.querySelector<HTMLElement>(`[data-command-block-id="stable-${id}"]`)!;
    element.scrollTop += item.getBoundingClientRect().top - element.getBoundingClientRect().top + 140;
  }, index);
  await move(0);
  await pinned.hover();
  await pinned.getByRole('button', { name: '收起命令标题' }).click();
  await expect(pinned).toHaveAttribute('data-collapsed', 'true');
  await page.mouse.move(0, 0);
  await scroll.evaluate(element => {
    const scope = window as unknown as { __headerFlashes: string[]; __stopHeaderWatch: () => void };
    scope.__headerFlashes = [];
    const observer = new MutationObserver(() => {
      const header = element.parentElement?.querySelector('[data-testid="pinned-command"]');
      if (header?.querySelector('.command-block-command, .command-block-label, .command-block-cwd')) scope.__headerFlashes.push(header.textContent ?? '');
    });
    observer.observe(element.parentElement!, { subtree: true, childList: true, attributes: true });
    scope.__stopHeaderWatch = () => observer.disconnect();
  });
  for (const index of [1, 2, 1, 0, 2]) {
    await move(index);
    await expect(pinned).toHaveAttribute('data-collapsed', 'true');
    await expect(pinned.locator('.command-block-command, .command-block-cwd')).toHaveCount(0);
  }
  await emitPtyOutput(page, `\x1b]133;A\x07\x1b]133;E;${btoa('tail -f hidden-live.log')}\x07\x1b]133;C\x07${'live log\r\n'.repeat(140)}`);
  await expect(async () => {
    await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(pinned).toHaveAttribute('data-running', 'true');
  }).toPass();
  await expect(pinned).toHaveAttribute('data-collapsed', 'true');
  await expect(pinned.locator('.command-block-label, .command-block-cwd')).toHaveCount(0);
  await expect(pinned.getByRole('button', { name: '终止命令', exact: true })).toBeVisible();
  expect(await page.evaluate(() => {
    const scope = window as unknown as { __headerFlashes: string[]; __stopHeaderWatch: () => void };
    scope.__stopHeaderWatch();
    return scope.__headerFlashes;
  })).toEqual([]);
  await pinned.hover();
  await pinned.getByRole('button', { name: '显示命令标题' }).click();
  await expect(pinned).toHaveAttribute('data-collapsed', 'false');
  await expect(pinned.locator('.command-block-label')).toHaveText('tail -f hidden-live.log');
});

test('pins the running toolbar in the same frame its status row starts to leave view', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.locator('[data-terminal-input]:visible')).toBeVisible();
  await emitPtyOutput(page, `\x1b]133;A\x07\x1b]133;E;${btoa('tail -f live.log')}\x07\x1b]133;C\x07${'live log\r\n'.repeat(140)}`);
  const host = page.getByTestId('running-term');
  await expect(host.locator('.xterm')).toBeVisible({ timeout: 5000 });
  const scroll = page.locator('[data-testid^="terminal-scroll-"]').first();
  const pinned = page.getByTestId('pinned-command');
  await expect(async () => {
    await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(pinned).toHaveAttribute('data-running', 'true');
  }).toPass();
  // Park the status row twelve pixels below the viewport top, then let a wheel gesture push it
  // just past the edge. The frame recorder below must never observe a partially clipped row
  // without the pinned copy already in place.
  await scroll.evaluate(element => {
    const row = element.querySelector<HTMLElement>('[data-testid^="running-block-"] .command-block-info')!;
    element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top - 12;
  });
  await expect(pinned).toHaveCount(0);
  await page.evaluate(() => {
    const scope = window as unknown as {
      __pinFrames: Array<{ rowTop: number; rowBottom: number; pinned: boolean }>;
      __stopPinFrames: () => void;
    };
    scope.__pinFrames = [];
    const scroll = document.querySelector<HTMLElement>('[data-testid^="terminal-scroll-"]')!;
    let running = true;
    const tick = () => {
      if (!running) return;
      const viewport = scroll.getBoundingClientRect();
      const row = scroll.querySelector<HTMLElement>('[data-testid^="running-block-"] .command-block-info');
      if (row) {
        const bounds = row.getBoundingClientRect();
        scope.__pinFrames.push({
          rowTop: bounds.top - viewport.top,
          rowBottom: bounds.bottom - viewport.top,
          pinned: !!document.querySelector('[data-testid="pinned-command"]'),
        });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    scope.__stopPinFrames = () => { running = false; };
  });
  const screen = host.locator('.xterm-screen');
  const screenBox = (await screen.boundingBox())!;
  await screen.hover({ position: { x: screenBox.width / 2, y: screenBox.height / 2 } });
  await page.mouse.wheel(0, 20);
  await page.waitForTimeout(250);
  const frames = await page.evaluate(() => {
    const scope = window as unknown as { __pinFrames: unknown[]; __stopPinFrames: () => void };
    scope.__stopPinFrames();
    return scope.__pinFrames;
  });
  const partial = (frames as Array<{ rowTop: number; rowBottom: number; pinned: boolean }>)
    .filter(frame => frame.rowTop < 0 && frame.rowBottom > 0);
  expect(partial.length).toBeGreaterThan(0);
  expect(partial.filter(frame => !frame.pinned)).toEqual([]);
  await expect(pinned).toHaveAttribute('data-running', 'true');
  const pinnedBox = (await pinned.boundingBox())!;
  const viewportBox = (await scroll.boundingBox())!;
  expect(Math.abs(pinnedBox.y - viewportBox.y)).toBeLessThan(1);
});
