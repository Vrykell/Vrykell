/**
 * terminalSnapshot — 用 xterm.js buffer 提取带颜色的 HTML 和纯文本。
 *
 * anser/正则无法处理光标移动、清屏、\r 覆盖写入等序列，
 * 只有终端模拟器自身能正确处理全部 ANSI 转义。
 */
import { Terminal } from '@xterm/xterm';
import { loadWebglRenderer } from '@features/terminal/model/xtermRenderer';
import type { IBufferCell } from '@xterm/xterm';
import { indexToCss } from '@features/terminal/model/blockTypes';
import { TERMINAL_FONT_FAMILY, getTerminalFontSize, TERMINAL_LINE_HEIGHT } from '@features/terminal/model/terminalFont';
import { useTypographyStore } from '@config/typography';
import { readXtermTheme } from '@features/terminal/model/xtermTheme';

function getFgCss(cell: IBufferCell): string | null {
  if (cell.isFgDefault()) return null;
  if (cell.isFgRGB())     return rgbToCss(cell.getFgColor());
  if (cell.isFgPalette()) return indexToCss(cell.getFgColor());
  return null;
}

function getBgCss(cell: IBufferCell): string | null {
  if (cell.isBgDefault()) return null;
  if (cell.isBgRGB())     return rgbToCss(cell.getBgColor());
  if (cell.isBgPalette()) return indexToCss(cell.getBgColor());
  return null;
}

function rgbToCss(color: number): string {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function cellStyle(cell: IBufferCell): string {
  const parts: string[] = [];
  const inverse = cell.isInverse();

  // 前景色（inverse 时取背景色）
  if (inverse) {
    const bg = getBgCss(cell);
    parts.push(`color:${bg ?? 'var(--xterm-bg)'}`);
  } else {
    const fg = getFgCss(cell);
    if (fg) parts.push(`color:${fg}`);
  }

  // 背景色（inverse 时取前景色）
  if (inverse) {
    const fg = getFgCss(cell);
    parts.push(`background:${fg ?? 'var(--text-primary)'}`);
  } else {
    const bg = getBgCss(cell);
    if (bg) parts.push(`background:${bg}`);
  }

  if (cell.isBold())           parts.push('font-weight:bold');
  if (cell.isItalic())         parts.push('font-style:italic');
  if (cell.isUnderline())      parts.push('text-decoration:underline');
  if (cell.isStrikethrough())  parts.push('text-decoration:line-through');
  if (cell.isDim())            parts.push('opacity:0.6');

  return parts.join(';');
}

export interface TerminalSnapshot {
  html: string;
  plainText: string;
}

export function extractSnapshotFromBuffer(
  buf: { length: number; getLine(y: number): { isWrapped?: boolean; translateToString(trim?: boolean): string; getCell(x: number, cell?: IBufferCell): IBufferCell | undefined } | undefined; getNullCell(): IBufferCell },
  cols: number,
  startLine?: number,
  endLine?: number,
  letterSpacingEm = 0,
  joinWrappedLines = false,
): TerminalSnapshot {
  const start = startLine ?? 0;
  const end = endLine ?? buf.length;
  const htmlLines: string[] = [];
  const textLines: string[] = [];
  const cell = buf.getNullCell();
  const spacing = Number.isFinite(letterSpacingEm) && Math.abs(letterSpacingEm) <= 0.2
    ? letterSpacingEm
    : 0;

  for (let y = start; y < end && y < buf.length; y++) {
    const line = buf.getLine(y);
    if (!line) continue;

    // Only the terminal buffer decides whether a row break is soft or explicit.
    const continues = joinWrappedLines && buf.getLine(y + 1)?.isWrapped === true;
    const text = line.translateToString(true);
    const wrapped = joinWrappedLines && line.isWrapped === true && htmlLines.length > 0;
    if (wrapped) textLines[textLines.length - 1] += text;
    else textLines.push(text);

    const spans: string[] = [];
    let currentStyle = '';
    let currentText = '';

    // Empty padding at a soft wrap can precede a double-width glyph on the next row.
    // Keep written spaces, but do not turn that padding into logical output characters.
    let lineCols = cols;
    if (continues) {
      while (lineCols > 0) {
        const last = line.getCell(lineCols - 1, cell);
        if (last && (last.getChars() || last.getWidth() === 0)) break;
        lineCols--;
      }
    }
    for (let x = 0; x < lineCols; x++) {
      const c = line.getCell(x, cell);
      if (!c) break;
      const width = c.getWidth();
      if (width === 0) continue;
      const chars = c.getChars() || ' ';
      const style = cellStyle(c);

      if (width === 2) {
        // CJK 全宽字符：xterm 里占 2 格（2ch），但 HTML 里浏览器回退字体
        // 按 1em 渲染（Menlo 13px 下 13px ≠ 15.65px），每字少 ~2.65px，
        // 光标（Xch 定位）和其后的排版全部向右漂移 ——
        // 包 inline-block 强制占满 2ch，让渲染宽度与网格严格一致。
        if (currentText) {
          spans.push(currentStyle
            ? `<span style="${currentStyle}">${currentText}</span>`
            : currentText);
        }
        const wide = 'display:inline-block;width:2ch';
        spans.push(style
          ? `<span style="${style};${wide}">${escapeHtml(chars)}</span>`
          : `<span style="${wide}">${escapeHtml(chars)}</span>`);
        currentStyle = '';
        currentText = '';
        continue;
      }

      if (style === currentStyle) {
        currentText += escapeHtml(chars);
      } else {
        if (currentText) {
          spans.push(currentStyle
            ? `<span style="${currentStyle}">${currentText}</span>`
            : currentText);
        }
        currentStyle = style;
        currentText = escapeHtml(chars);
      }
    }

    if (currentText) {
      spans.push(currentStyle
        ? `<span style="${currentStyle}">${currentText}</span>`
        : currentText);
    }

    const renderedLine = continues ? spans.join('') : spans.join('').replace(/ +$/, '');
    // Keep blank rows empty so metric styling cannot turn viewport padding
    // into visible output after trailing rows are trimmed.
    const html = spacing && renderedLine.trim()
      ? `<span style="letter-spacing:${spacing.toFixed(5)}em">${renderedLine}</span>`
      : renderedLine;
    if (wrapped) htmlLines[htmlLines.length - 1] += html;
    else htmlLines.push(html);
  }

  while (htmlLines.length > 0 && htmlLines[htmlLines.length - 1]!.trim() === '') htmlLines.pop();
  while (textLines.length > 0 && textLines[textLines.length - 1]!.trim() === '') textLines.pop();

  return { html: htmlLines.join('<br>'), plainText: textLines.join('\n') };
}

export async function captureTerminalOutput(rawAnsi: string, cols: number): Promise<TerminalSnapshot> {
  if (!rawAnsi.trim()) return { html: '', plainText: '' };

  const safeCols = Math.max(cols || 80, 1);
  const promptIdx = rawAnsi.lastIndexOf('\x1b]133;A\x07');
  const cleanAnsi = promptIdx >= 0 ? rawAnsi.slice(0, promptIdx) : rawAnsi;
  if (!cleanAnsi.trim()) return { html: '', plainText: '' };

  const { term, dispose } = createOffscreenTerm(safeCols);
  try {
    await new Promise<void>((resolve) => { term.write(cleanAnsi, () => resolve()); });
    await new Promise((r) => setTimeout(r, 0));
    return extractSnapshotFromBuffer(term.buffer.active, safeCols);
  } finally {
    dispose();
  }
}

export function createOffscreenTerm(
  cols: number,
  rows = 24,
  scrollback = 5000,
): { term: Terminal; dispose: () => void } {
  const el = document.createElement('div');
  el.style.cssText =
    'position:absolute;left:0;top:0;visibility:hidden;width:800px;height:600px;overflow:hidden;pointer-events:none';
  document.body.appendChild(el);
  const term = new Terminal({
    cols: Math.max(cols || 80, 1),
    rows,
    scrollback,
    allowTransparency: true,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: getTerminalFontSize(),
    lineHeight: TERMINAL_LINE_HEIGHT,
  });
  term.open(el);
  return {
    term,
    dispose: () => {
      term.dispose();
      el.remove();
    },
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * createBlockTerm creates the live xterm used while a command is running.
 * It preserves native cursor, IME, selection, and CJK layout.
 *
 * 创建时**不 open**（xterm v5 的 write 先于 open 是安全的：解析器与 buffer
 * 是 core 服务，open 只接管 DOM/渲染；xterm-headless 即此用法）。
 * RunningItem moves the element into the output stream and opens it. The controller
 * owns its lifecycle; completed blocks use a matching HTML snapshot and font metrics.
 */
export function createBlockTerm(
  cols: number,
  rows: number,
): { term: Terminal; el: HTMLDivElement; dispose: () => void } {
  // Use the same terminal background for live output and completed snapshots.
  const el = document.createElement('div');
  el.style.cssText = 'overflow:hidden;width:100%;background:var(--xterm-bg)';
  const xtermTheme = readXtermTheme();
  const term = new Terminal({
    cols: Math.max(cols || 80, 1),
    rows: Math.max(rows || 24, 1),
    scrollback: 5000,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: getTerminalFontSize(),
    lineHeight: TERMINAL_LINE_HEIGHT,
    cursorBlink: true,
    theme: xtermTheme,
  });
  // Running output must follow palette changes just like the surrounding pane.
  const themeObserver = new MutationObserver(() => {
    term.options.theme = { ...term.options.theme, ...readXtermTheme() };
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-theme'] });
  const unsubscribeTypography = useTypographyStore.subscribe((state, previous) => {
    if (state.terminalFontSize !== previous.terminalFontSize) term.options.fontSize = state.terminalFontSize;
  });
  // Same renderer as the main terminal: WebGL keeps half-block glyphs seamless, and the shared
  // helper steps down to the DOM renderer when the GPU context is lost or WebGL is unavailable.
  loadWebglRenderer(term, useTypographyStore.getState().terminalRenderer);
  return {
    term,
    el,
    dispose: () => {
      themeObserver.disconnect();
      unsubscribeTypography();
      term.dispose();
      el.remove();
    },
  };
}
