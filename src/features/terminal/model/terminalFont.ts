/** Shared font metrics for the terminal canvas and block snapshots. */
import { useTypographyStore } from '@config/typography';
export const TERMINAL_FONT_FAMILY =
  'Menlo, Monaco, "Cascadia Code", "JetBrains Mono", "Noto Sans Mono", "DejaVu Sans Mono", "Noto Sans CJK SC", "PingFang SC", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", monospace';

export function getTerminalFontSize(): number { return useTypographyStore.getState().terminalFontSize; }
export const TERMINAL_LINE_HEIGHT = 1.0;

/** Measure the browser glyph width used by completed block snapshots. */
export function measureTerminalDomCellWidth(fontSize = getTerminalFontSize()): number {
  const probe = document.createElement('span');
  probe.style.cssText =
    'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;line-height:1;';
  probe.style.fontFamily = TERMINAL_FONT_FAMILY;
  probe.style.fontSize = `${fontSize}px`;
  probe.textContent = 'W'.repeat(100);
  document.body.appendChild(probe);
  const width = probe.getBoundingClientRect().width / 100;
  probe.remove();
  return width;
}
