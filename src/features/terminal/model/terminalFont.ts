/** Shared font metrics for the terminal canvas and block snapshots. */
import { terminalFontFamily, terminalTypographyChanged, useTypographyStore } from '@config/typography';
export const TERMINAL_FONT_FAMILY = 'var(--terminal-font-family)';

export function getTerminalFontSize(): number { return useTypographyStore.getState().terminalFontSize; }

/** Resolve the same font settings for canvas output and historical DOM output. */
export function getTerminalFontOptions() {
  const state = useTypographyStore.getState();
  return {
    fontFamily: terminalFontFamily(state.terminalFontPreset),
    fontSize: state.terminalFontSize,
    fontWeight: state.terminalFontWeight,
    fontWeightBold: Math.max(700, state.terminalFontWeight),
    lineHeight: state.terminalLineHeight,
    letterSpacing: applyMeasuredSpacing(),
  };
}

/**
 * Snap the cell advance to whole CSS pixels: a fractional
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
  probe.style.fontFamily = terminalFontFamily(useTypographyStore.getState().terminalFontPreset);
  probe.style.fontWeight = String(useTypographyStore.getState().terminalFontWeight);
  probe.style.fontSize = `${fontSize}px`;
  probe.textContent = 'W'.repeat(100);
  document.body.appendChild(probe);
  const width = probe.getBoundingClientRect().width / 100;
  probe.remove();
  return width;
}

/** Historical output follows the current cell grid, including stored snapshots. */
function applyMeasuredSpacing(): number {
  const spacing = terminalLetterSpacing();
  const root = document.documentElement.style;
  const value = `${spacing}px`;
  if (root.getPropertyValue('--terminal-letter-spacing') !== value) root.setProperty('--terminal-letter-spacing', value);
  return spacing;
}

useTypographyStore.subscribe((state, previous) => {
  if (typeof document !== 'undefined' && document.body && terminalTypographyChanged(state, previous)) applyMeasuredSpacing();
});
