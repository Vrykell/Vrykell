import { test, expect } from '@playwright/test';
import { setupTauriMock, emitPtyOutput, ptyResizes } from './tauri-mock';

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

test('满宽 box-drawing 输出在块内回流折行，不横向滚动', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
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
      gridRows: rows.length,
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

  // 统一回流：宽行在块内折行，不产生横向滚动（内容不溢出内容盒）。
  expect(diag.clientWidth).toBeGreaterThan(0);
  expect(diag.scrollWidth - diag.clientWidth).toBeLessThanOrEqual(1);
});

test('运行中卡片：PTY/块终端宽度跟随卡片内容宽（右缘不裁剪）', async ({ page }) => {
  await setupTauriMock(page);
  await page.goto('/');
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
        hostContentW: el.clientWidth - 16, // .xterm 左右各 8px padding
      };
    });

    // 画布不超宽：screen ≤ 宿主内容宽（+1 容差防亚像素取整）
    expect(probe.screenW).toBeLessThanOrEqual(probe.hostContentW + 1);

    // 右缘不裁剪：PTY 全部列能完整放进画布（cellWidth≈8px，容差亚像素）
    const last = rs[rs.length - 1]!;
    expect(last.cols * 8).toBeLessThanOrEqual(probe.screenW + 1);
  }).toPass({ timeout: 5000 });
});
