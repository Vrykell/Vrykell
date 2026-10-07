/** Shared font metrics for the terminal canvas and block snapshots. */
import { useTypographyStore } from '@config/typography';
/**
 * The first families all cover box drawing and block elements at one cell width, so
 * frames and charts stay aligned. The generic `monospace` comes before the emoji
 * families: an emoji fallback is proportional and would break the character grid.
 */
export const TERMINAL_FONT_FAMILY =
  '"Cascadia Mono", "Cascadia Code", Menlo, Monaco, "JetBrains Mono", "Sarasa Mono SC", "Noto Sans Mono CJK SC", "Noto Sans Mono", "DejaVu Sans Mono", monospace, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"';

export function getTerminalFontSize(): number { return useTypographyStore.getState().terminalFontSize; }
export const TERMINAL_LINE_HEIGHT = 1.0;

/**
 * Snap the cell advance to whole CSS pixels, the way Windows Terminal does: a fractional
 * advance (for example 8.4px at a 14px font) leaves a sub-pixel column at the right edge of
 * the canvas, which shows up as a bright seam beside a selection. `letterSpacing` absorbs the
 * fraction - at most half a pixel per cell - so the grid lands on device pixels.
 */
export function snapLetterSpacing(measuredCellWidth: number): number {
  if (!Number.isFinite(measuredCellWidth) || measuredCellWidth <= 0) return 0;
  const spacing = Math.round(measuredCellWidth) - measuredCellWidth;
  return Math.abs(spacing) < 0.01 ? 0 : spacing;
}

/** The same snap, measured from the real font stack at the current terminal font size. */
export function terminalLetterSpacing(fontSize = getTerminalFontSize()): number {
  return snapLetterSpacing(measureTerminalDomCellWidth(fontSize));
}

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
