import { test, expect } from '@playwright/test';
import { setupTauriMock, emitPtyOutput, ptyResizes } from './tauri-mock';

test('maximized command output uses the available columns without a fixed 80-column limit', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.locator('[data-testid^="terminal-scroll-"]').first()).toBeVisible();
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await page.getByRole('button', { name: '关闭标签面板' }).click();
  await page.setViewportSize({ width: 1550, height: 1000 });
  await expect.poll(async () => (await ptyResizes(page)).at(-1)?.cols ?? 0).toBeGreaterThan(160);
  const cols = (await ptyResizes(page)).at(-1)!.cols;
  const line = 'wide-output-start ' + 'x'.repeat(cols - 38) + ' wide-output-end';
  await emitPtyOutput(page, `\x1b]133;E;${btoa('wide-output')}\x07\x1b]133;C\x07${line}\r\n\x1b]133;D;0\x07`);
  const output = page.locator('[data-testid^="command-block-"] [data-selectable]').last();
  await expect(output).toContainText(line);
  expect(await output.locator(':scope > div').innerHTML()).not.toContain('<br>');
  const bounds = await output.evaluate(el => ({ width: el.clientWidth, overflow: el.scrollWidth - el.clientWidth }));
  expect(bounds.width).toBeGreaterThan(1400);
  expect(bounds.overflow).toBeLessThanOrEqual(1);
});

test('output longer than the viewport stays complete without a false truncation notice', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.locator('[data-testid^="terminal-scroll-"]').first()).toBeVisible();
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  const lines = Array.from({ length: 100 }, (_, i) => `help-line-${i}`);
  await emitPtyOutput(page, `\x1b]133;E;${btoa('git --help')}\x07\x1b]133;C\x07${lines.join('\r\n')}\r\n\x1b]133;D;0\x07`);
  const block = page.locator('[data-testid^="command-block-"]').last();
  await expect(block).toContainText('help-line-99');
  await expect(block).toContainText('help-line-0');
  await expect(block).not.toContainText('已截断');
  expect(await block.locator('[data-selectable] > div').last().evaluate(el => el.innerHTML.split('<br>').length)).toBe(100);
});

/**
 * 满宽 TUI 输出（box-drawing）在块卡片内的渲染诊断/回归：
 * 快照 HTML 每行已按网格 cols 预分行（<br> 分隔，每行 ≤ cols 字符）。
 * 若卡片内容盒宽度放不下 cols 个字符，pre-wrap 会在网格行中间软换行 → TUI 框线撕裂。
 */

interface Diag {
  cols: number; // 网格列数（满宽行的字符数）
  gridRows: number; // 快照网格行数（<br> + 1）
  visualLines: number; // 实际视觉行数（scrollHeight / 行高）
  clientWidth: number; // BlockOutput 内容盒宽（CSS px）
  charWidth: number; // 实测字符宽（CSS px）
  capacityChars: number; // 内容盒能放下的整字符数
  lineHeightPx: number;
  innerWidth: number;
}

test('long box-drawing rows reflow to the available columns without horizontal scrolling', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.locator('[data-testid^="terminal-scroll-"]').first()).toBeVisible();
  const input = page.getByPlaceholder(/输入命令/);
  await expect(input).toBeVisible({ timeout: 5000 });

  // 一个 done block：3 行各 400 个 ─（必然超过 cols，离屏 xterm 按 cols 折行）
  const E = `\x1b]133;E;${btoa('tui-box')}\x07`;
  const C = '\x1b]133;C\x07';
  const rows = Array(3).fill('─'.repeat(400)).join('\r\n') + '\r\n';
  const tail =
    `\x1b]7;file://host/home/e2e/project\x07\x1b]133;D;0\x07` +
    `\x1b]133;A\x07~/project\x1b]133;G;${btoa('main')}\x07 $ `;
  await emitPtyOutput(page, E + C + rows + tail);

  // 等输出渲染（快照提取是异步的）。
  // 注意取「最内层」匹配 div：外层容器同样 includes('<br>')，会误中。
  const findOutput = () =>
    page.evaluate(() => {
      const matches = Array.from(document.querySelectorAll('div')).filter(
        (d) => d.innerHTML.includes('<br>') && d.textContent?.includes('─'.repeat(40)),
      );
      matches.sort((a, b) => a.innerHTML.length - b.innerHTML.length);
      return matches[0]?.innerHTML.length ?? 0;
    });
  await expect.poll(findOutput).toBeGreaterThan(0);

  const diag = await page.evaluate((): Diag & { scrollWidth: number } => {
    const matches = Array.from(document.querySelectorAll('div')).filter(
      (d) => d.innerHTML.includes('<br>') && d.textContent?.includes('─'.repeat(40)),
    );
    matches.sort((a, b) => a.innerHTML.length - b.innerHTML.length);
    const el = matches[0]!;
    const rows = el.innerHTML.split('<br>');
    const strip = (s: string) => s.replace(/<[^>]*>/g, '');
    const rowLens = rows.map((r) => strip(r).length);
    const cols = Math.max(...rowLens);

    const cs = getComputedStyle(el);
    const lineHeightPx = parseFloat(cs.lineHeight);
    // scrollHeight 含上下 padding，计算视觉行数需扣除
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const contentHeight = el.scrollHeight - padY;

    // 实测字符宽：在该元素内插一个 100 字符的 probe（继承字体）
    const probe = document.createElement('span');
    probe.style.whiteSpace = 'pre';
    probe.textContent = '─'.repeat(100);
    el.appendChild(probe);
    const charWidth = probe.getBoundingClientRect().width / 100;
    probe.remove();

    return {
      cols,
      gridRows: rowLens.reduce((count, length) => count + Math.max(1, Math.ceil(length / Math.floor(el.clientWidth / charWidth))), 0),
      visualLines: Math.round((contentHeight / lineHeightPx) * 10) / 10,
      clientWidth: el.clientWidth,
      charWidth: Math.round(charWidth * 1000) / 1000,
      capacityChars: Math.floor(el.clientWidth / charWidth),
      lineHeightPx,
      innerWidth: window.innerWidth,
      scrollWidth: el.scrollWidth,
    };
  });

  console.log('WIDTH-DIAG', JSON.stringify(diag, null, 2));

  // Logical rows wrap to the measured available columns without horizontal scrolling.
  expect(diag.clientWidth).toBeGreaterThan(0);
  expect(diag.scrollWidth - diag.clientWidth).toBeLessThanOrEqual(1);
  // 行高 1.0 下字形 font metrics 有亚像素溢出，scrollHeight 会多计 ~0.1 行；
  // 折行则会差 1 行以上 —— 用容差区分。
  expect(Math.abs(diag.visualLines - diag.gridRows)).toBeLessThan(0.2);
});

test('resizing a running block resizes both PTY and terminal buffer, then restores its width', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.locator('[data-testid^="terminal-scroll-"]').first()).toBeVisible();
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  // Wait for the shell startup prompt before injecting a sustained command.
  await page.waitForFunction(async () => {
    const path = '/src/features/terminal/stores/terminal.ts';
    const { useTerminalStore } = await import(path) as typeof import('../src/features/terminal/stores/terminal');
    return Object.values(useTerminalStore.getState().startupStates).includes('ready');
  });
  await emitPtyOutput(page, `\x1b]133;E;${btoa('running-output')}\x07\x1b]133;C\x07${'x'.repeat(300)}\r\n`);
  const host = page.getByTestId('running-term');
  await expect(host.locator('.xterm')).toBeVisible();
  const terminal = () => page.evaluate(() => {
    const terms = (window as unknown as { __vrykellTerms: Map<string, import('@xterm/xterm').Terminal> }).__vrykellTerms;
    const term = [...terms.entries()].find(([key]) => key.startsWith('block:'))![1];
    const lines = Array.from({ length: term.buffer.active.length }, (_, row) => term.buffer.active.getLine(row)?.translateToString(true) ?? '').filter(Boolean);
    return { cols: term.cols, rows: lines.length, text: lines.join('') };
  });
  await expect.poll(() => terminal().then(value => value.text)).toBe('x'.repeat(300));
  const before = await terminal();
  await page.setViewportSize({ width: 850, height: 800 });
  await expect.poll(() => terminal().then(value => value.cols)).toBeLessThan(before.cols);
  const narrow = await terminal();
  await expect.poll(() => ptyResizes(page).then(resizes => resizes.at(-1)?.cols)).toBe(narrow.cols);
  expect(narrow.rows).toBeGreaterThan(before.rows);
  expect(narrow.text).toBe(before.text);
  expect(await host.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1240, height: 800 });
  await expect.poll(() => terminal().then(value => value.cols)).toBe(before.cols);
  await expect.poll(() => terminal().then(value => value.rows)).toBe(before.rows);
});

test('opening the assistant resizes the PTY and wraps completed output without horizontal scrolling', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.locator('[data-testid^="terminal-scroll-"]').first()).toBeVisible();
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await expect.poll(async () => (await ptyResizes(page)).at(-1)?.cols ?? 0).toBeGreaterThan(100);
  const row = '-a--    2026/10/04    12:30    2048    ' + 'file-name-'.repeat(6);
  await emitPtyOutput(page, `\x1b]133;E;${btoa('table-output')}\x07\x1b]133;C\x07${row}\r\n${row}\r\n\x1b]133;D;0\x07`);
  const output = page.locator('[data-testid^="command-block-"] [data-selectable]').last();
  await expect(output).toContainText('file-name-');
  const grid = output.locator(':scope > div');
  const before = await grid.evaluate(el => ({ height: el.clientHeight, text: el.textContent, html: el.innerHTML }));
  const beforeCols = (await ptyResizes(page)).at(-1)!.cols;
  await page.locator('[data-dock-btn="chat"]').click();
  await expect(page.getByPlaceholder(/自然语言描述/)).toBeVisible();
  await expect.poll(() => (ptyResizes(page)).then(resizes => resizes.at(-1)!.cols)).toBeLessThan(beforeCols);
  await expect.poll(() => grid.evaluate(el => el.clientHeight)).toBeGreaterThan(before.height);
  expect(await grid.textContent()).toBe(before.text);
  expect(await grid.innerHTML()).toBe(before.html);
  await expect.poll(() => output.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  const atEnd = await output.evaluate(el => {
    el.scrollLeft = el.scrollWidth;
    return el.scrollLeft;
  });
  expect(atEnd).toBe(0);
  await page.locator('[data-dock-btn="chat"]').click();
  await expect.poll(() => grid.evaluate(el => el.clientHeight)).toBe(before.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});

test('line-editor repaint does not add a prompt or inherited blank rows to command output', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.locator('[data-testid^="terminal-scroll-"]').first()).toBeVisible();
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible();
  await emitPtyOutput(page, '\x1b]133;A\x07PS> \r\n\x1b[9;1Hls\r\n\x1b]133;E;bHM=\x07\x1b]133;C\x07\x1b[H\x1b[2JMode  Name\r\nd---  Documents\r\n\x1b]133;D;0\x07');
  const output = page.locator('[data-testid^="command-block-"] [data-selectable]').last();
  await expect(output).toContainText('Documents');
  await expect(output).not.toContainText('PS>');
  const grid = output.locator(':scope > div');
  expect(await grid.evaluate(el => el.clientHeight)).toBeLessThanOrEqual(34);
});

test('运行中卡片：PTY/块终端宽度跟随卡片内容宽（右缘不裁剪）', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.locator('[data-testid^="terminal-scroll-"]').first()).toBeVisible();
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });

  // 运行中块（活 xterm 挂载进卡片）
  await emitPtyOutput(page, `\x1b]133;E;${btoa('sleep 100')}\x07\x1b]133;C\x07`);
  const host = page.getByTestId('running-term');
  await expect(host.locator('.xterm')).toBeVisible({ timeout: 5000 });

  // RunningTerm 宿主 ResizeObserver 首回调 → syncTermWidth → pty_resize 收窄到卡片宽
  //（回归：PTY 曾恒为主终端全宽，卡片比主表面窄 ~50px，输出右缘被裁掉
  //  ——「输出宽度与可显示宽度不一致导致部分边缘看不到」）
  await expect(async () => {
    const rs = await ptyResizes(page);
    expect(rs.length).toBeGreaterThan(0);

    const probe = await host.evaluate((el) => {
      const screen = el.querySelector<HTMLElement>('.xterm-screen')!;
      // WebGL renderer 下 xterm 不向 DOM 注入字体，canvas 按 renderer 内部
      // cellWidth（实测 8px）排布；PTY cols 也由同一 cellWidth 计算。
      // 断言画布完整容纳 PTY 列数（右缘不裁剪），cellWidth 用 8 作参考容差。
      return {
        screenW: screen.getBoundingClientRect().width,
        hostContentW: el.clientWidth, // The command block supplies all horizontal spacing.
      };
    });

    // 画布不超宽：screen ≤ 宿主内容宽（+1 容差防亚像素取整）
    expect(probe.screenW).toBeLessThanOrEqual(probe.hostContentW + 1);

    // 右缘不裁剪：PTY 全部列能完整放进画布（cellWidth≈8px，容差亚像素）
    const last = rs[rs.length - 1]!;
    expect(last.cols * 8).toBeLessThanOrEqual(probe.screenW + 1);
  }).toPass({ timeout: 5000 });
});

test('运行中输出与完成快照保持相同字符宽度', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.locator('[data-testid^="terminal-scroll-"]').first()).toBeVisible();
  await expect(page.getByPlaceholder(/输入命令/)).toBeVisible({ timeout: 5000 });
  await emitPtyOutput(page, `\x1b]133;E;${btoa('ls')}\x07\x1b]133;C\x07`);
  const host = page.getByTestId('running-term');
  await expect(host.locator('.xterm-screen')).toBeVisible();
  const running = await host.evaluate((el) => {
    const screen = el.querySelector<HTMLElement>('.xterm-screen')!;
    type MeasuredTerm = { cols: number };
    const terms = (window as unknown as { __vrykellTerms: Map<string, MeasuredTerm> }).__vrykellTerms;
    const term = [...terms.entries()].find(([key]) => key.startsWith('block:'))?.[1];
    const rect = screen.getBoundingClientRect();
    return { cols: term!.cols, screenLeft: rect.left, screenWidth: rect.width };
  });
  const output = 'W'.repeat(running.cols);
  await emitPtyOutput(page, output);
  await emitPtyOutput(page, '\x1b]133;D;0\x07');
  const blockOutput = page.locator('[data-testid^="command-block-"] [data-selectable]').last();
  await expect(blockOutput).toContainText(output);
  const completed = await blockOutput.evaluate((el) => {
    const content = el.querySelector(':scope > div')!;
    const range = document.createRange();
    range.selectNodeContents(content);
    const rect = range.getBoundingClientRect();
    return { left: rect.left, width: rect.width };
  });
  expect(Math.abs(completed.left - running.screenLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(completed.width - running.screenWidth)).toBeLessThanOrEqual(1);
});

test('命令块分隔线延伸到终端左右边缘', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
  await expect(page.locator('[data-testid^="terminal-scroll-"]').first()).toBeVisible();
  const input = page.getByPlaceholder(/输入命令/);
  await expect(input).toBeVisible({ timeout: 5000 });
  for (const command of ['echo first', 'echo second']) {
    await input.fill(command);
    await input.press('Enter');
  }
  const blocks = page.locator('[data-testid^="command-block-"]');
  await expect(blocks).toHaveCount(2);
  const bounds = await blocks.nth(1).evaluate((block) => {
    const scroll = block.closest<HTMLElement>('[data-testid^="terminal-scroll-"]')!;
    const b = block.getBoundingClientRect();
    const s = scroll.getBoundingClientRect();
    return {
      leftGap: b.left - s.left,
      rightGap: s.left + scroll.clientLeft + scroll.clientWidth - b.right,
      borderTop: getComputedStyle(block).borderTopWidth,
      contentInset: parseFloat(getComputedStyle(block).paddingLeft),
    };
  });
  expect(Math.abs(bounds.leftGap)).toBeLessThanOrEqual(1);
  expect(Math.abs(bounds.rightGap)).toBeLessThanOrEqual(1);
  expect(bounds.borderTop).toBe('1px');
  expect(bounds.contentInset).toBeGreaterThan(0);
});
