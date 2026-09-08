/**
 * terminalSnapshot — 用 xterm.js buffer 提取带颜色的 HTML 和纯文本。
 *
 * anser/正则无法处理光标移动、清屏、\r 覆盖写入等序列，
 * 只有终端模拟器自身能正确处理全部 ANSI 转义。
 */

import { WebglAddon } from '@xterm/addon-webgl';
import type { IBufferCell } from '@xterm/xterm';
import { Terminal } from '@xterm/xterm';
import { indexToCss } from '@/features/terminal/blockTypes';

function getFgCss(cell: IBufferCell): string | null {
  if (cell.isFgDefault()) return null;
  if (cell.isFgRGB()) return rgbToCss(cell.getFgColor());
  if (cell.isFgPalette()) return indexToCss(cell.getFgColor());
  return null;
}

function getBgCss(cell: IBufferCell): string | null {
  if (cell.isBgDefault()) return null;
  if (cell.isBgRGB()) return rgbToCss(cell.getBgColor());
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
    if (bg) parts.push(`color:${bg}`);
  } else {
    const fg = getFgCss(cell);
    if (fg) parts.push(`color:${fg}`);
  }

  // 背景色（inverse 时取前景色）
  if (inverse) {
    const fg = getFgCss(cell);
    if (fg) parts.push(`background:${fg}`);
  } else {
    const bg = getBgCss(cell);
    if (bg) parts.push(`background:${bg}`);
  }

  if (cell.isBold()) parts.push('font-weight:bold');
  if (cell.isItalic()) parts.push('font-style:italic');
  if (cell.isUnderline()) parts.push('text-decoration:underline');
  if (cell.isStrikethrough()) parts.push('text-decoration:line-through');
  if (cell.isDim()) parts.push('opacity:0.6');

  return parts.join(';');
}

export interface TerminalSnapshot {
  html: string;
  plainText: string;
}

export function extractSnapshotFromBuffer(
  buf: {
    length: number;
    getLine(y: number):
      | {
          translateToString(trim?: boolean): string;
          getCell(x: number, cell?: IBufferCell): IBufferCell | undefined;
        }
      | undefined;
    getNullCell(): IBufferCell;
  },
  cols: number,
  startLine?: number,
  endLine?: number,
): TerminalSnapshot {
  const start = startLine ?? 0;
  const end = endLine ?? buf.length;
  const htmlLines: string[] = [];
  const textLines: string[] = [];
  const cell = buf.getNullCell();

  for (let y = start; y < end && y < buf.length; y++) {
    const line = buf.getLine(y);
    if (!line) continue;

    textLines.push(line.translateToString(true));

    const spans: string[] = [];
    let currentStyle = '';
    let currentText = '';

    for (let x = 0; x < cols; x++) {
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
          spans.push(
            currentStyle ? `<span style="${currentStyle}">${currentText}</span>` : currentText,
          );
        }
        const wide = 'display:inline-block;width:2ch';
        spans.push(
          style
            ? `<span style="${style};${wide}">${escapeHtml(chars)}</span>`
            : `<span style="${wide}">${escapeHtml(chars)}</span>`,
        );
        currentStyle = '';
        currentText = '';
        continue;
      }

      if (style === currentStyle) {
        currentText += escapeHtml(chars);
      } else {
        if (currentText) {
          spans.push(
            currentStyle ? `<span style="${currentStyle}">${currentText}</span>` : currentText,
          );
        }
        currentStyle = style;
        currentText = escapeHtml(chars);
      }
    }

    if (currentText) {
      spans.push(
        currentStyle ? `<span style="${currentStyle}">${currentText}</span>` : currentText,
      );
    }

    htmlLines.push(spans.join('').replace(/ +$/, ''));
  }

  while (htmlLines.length > 0 && htmlLines[htmlLines.length - 1]!.trim() === '') htmlLines.pop();
  while (textLines.length > 0 && textLines[textLines.length - 1]!.trim() === '') textLines.pop();

  return { html: htmlLines.join('<br>'), plainText: textLines.join('\n') };
}

export async function captureTerminalOutput(
  rawAnsi: string,
  cols: number,
): Promise<TerminalSnapshot> {
  if (!rawAnsi.trim()) return { html: '', plainText: '' };

  const safeCols = Math.max(cols || 80, 1);
  const promptIdx = rawAnsi.lastIndexOf('\x1b]133;A\x07');
  const cleanAnsi = promptIdx >= 0 ? rawAnsi.slice(0, promptIdx) : rawAnsi;
  if (!cleanAnsi.trim()) return { html: '', plainText: '' };

  const { term, dispose } = createOffscreenTerm(safeCols);
  try {
    await new Promise<void>((resolve) => {
      term.write(cleanAnsi, () => resolve());
    });
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
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 与主 xterm / BlockOutput CSS 一致的字体栈（活 block 终端必须同源，否则完成切换时跳变） */
export const XTERM_FONT_FAMILY =
  'Menlo, Monaco, "Cascadia Code", "JetBrains Mono", "Noto Sans CJK SC", "PingFang SC", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", monospace';

/**
 * createBlockTerm — 运行中 block 的活终端（：块内是真实 xterm 栅格，
 * 原生光标/IME/选择/CJK 对齐，不再走 250ms HTML 快照同步）。
 *
 * 创建时**不 open**（xterm v5 的 write 先于 open 是安全的：解析器与 buffer
 * 是 core 服务，open 只接管 DOM/渲染；xterm-headless 即此用法）。
 * RunningItem 挂载后把 el 移进卡片并 term.open(el)；生命周期归 controller
 * （块完成提取快照后 dispose）。lineHeight 1.0 与完成块 HTML 快照行高一致
 * （14px），完成切换无跳动。
 */
export function createBlockTerm(
  cols: number,
  rows: number,
): { term: Terminal; el: HTMLDivElement; dispose: () => void } {
  const cs = getComputedStyle(document.documentElement);
  // 深色圆角盒子：canvas 直接画 --xterm-bg（不依赖 WebKit 的透明 canvas 支持），
  // el 同底色兜底 padding 环带 —— 两种渲染引擎下观感一致
  const el = document.createElement('div');
  el.style.cssText = 'overflow:hidden;width:100%;background:var(--xterm-bg);border-radius:6px';
  const term = new Terminal({
    cols: Math.max(cols || 80, 1),
    rows: Math.max(rows || 24, 1),
    scrollback: 5000,
    fontFamily: XTERM_FONT_FAMILY,
    fontSize: 14,
    lineHeight: 1.0,
    cursorBlink: true,
    theme: {
      background: cs.getPropertyValue('--xterm-bg').trim() || '#050505',
      foreground: cs.getPropertyValue('--text-primary').trim() || '#e8e8e8',
      cursor: cs.getPropertyValue('--xterm-cursor').trim() || '#e8e8e8',
      selectionBackground:
        cs.getPropertyValue('--xterm-selection').trim() || 'rgba(255,255,255,0.25)',
    },
  });
  // 与主终端一致：WebGL renderer 让半块字符拼接无缝（TUI 图标无横裂缝）；
  // 无 GPU 时回退 DOM renderer（xterm 内部行为）
  try {
    term.loadAddon(new WebglAddon());
  } catch {
    // 忽略：回退默认 renderer
  }
  return {
    term,
    el,
    dispose: () => {
      term.dispose();
      el.remove();
    },
  };
}
