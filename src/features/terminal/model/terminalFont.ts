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
    letterSpacing: applyMeasuredMetrics(),
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
  const probe = createFontProbe(fontSize, '1');
  if (!probe) return 0;
  probe.textContent = 'W'.repeat(100);
  const width = probe.getBoundingClientRect().width / 100;
  probe.remove();
  return width;
}

/**
 * Truncated cell height for a measured line box - the same derivation the canvas uses, so a
 * snapshot row and a canvas row are the same height. A formula over the font size alone drifts
 * from the resolved font by several pixels, which makes consecutive snapshot rows overlap and
 * turns solid or reverse-video output into merged bands.
 */
export function cellHeightFromLineBox(naturalLineBox: number, lineHeight: number): number {
  if (!Number.isFinite(naturalLineBox) || naturalLineBox <= 0) return 0;
  const scale = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 1;
  return Math.floor(naturalLineBox * scale);
}

/**
 * Row height for completed block snapshots, measured from the resolved font instead of
 * approximated from the font size.
 */
export function measureTerminalDomCellHeight(
  fontSize = getTerminalFontSize(),
  lineHeight = useTypographyStore.getState().terminalLineHeight,
): number {
  const measured = cellHeightFromLineBox(measureTerminalNaturalLineBox(fontSize), lineHeight);
  if (measured > 0) return measured;
  // Without a measuring DOM (unit tests) keep the previous estimate rather than collapsing rows.
  return Math.ceil(fontSize * 16 / 14 * lineHeight);
}

/** Natural line box of the terminal font: ascent plus descent, before the line-height factor. */
function measureTerminalNaturalLineBox(fontSize: number): number {
  const probe = createFontProbe(fontSize, 'normal');
  if (!probe) return 0;
  probe.textContent = 'W';
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return height;
}

function createFontProbe(fontSize: number, lineHeight: string): HTMLSpanElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  const state = useTypographyStore.getState();
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;';
  probe.style.fontFamily = terminalFontFamily(state.terminalFontPreset);
  probe.style.fontWeight = String(state.terminalFontWeight);
  probe.style.fontSize = `${fontSize}px`;
  probe.style.lineHeight = lineHeight;
  document.body.appendChild(probe);
  return probe;
}

/**
 * Publish the metrics a completed snapshot needs but cannot read from preferences: the snapped
 * cell advance and the measured cell height. Both follow the resolved font, so historical output
 * keeps the grid the canvas drew.
 */
function applyMeasuredMetrics(): number {
  const spacing = terminalLetterSpacing();
  if (typeof document !== 'undefined' && document.body) {
    const root = document.documentElement.style;
    const spacingValue = `${spacing}px`;
    if (root.getPropertyValue('--terminal-letter-spacing') !== spacingValue) root.setProperty('--terminal-letter-spacing', spacingValue);
    const heightValue = `${measureTerminalDomCellHeight()}px`;
    if (root.getPropertyValue('--terminal-row-height') !== heightValue) root.setProperty('--terminal-row-height', heightValue);
  }
  return spacing;
}

useTypographyStore.subscribe((state, previous) => {
  if (typeof document !== 'undefined' && document.body && terminalTypographyChanged(state, previous)) applyMeasuredMetrics();
});

// A fallback font satisfies the probe until the preferred family finishes loading; re-measure
// once the font set settles so snapshots keep the canvas grid.
if (typeof document !== 'undefined' && document.fonts) {
  void document.fonts.ready.then(() => applyMeasuredMetrics());
}

applyMeasuredMetrics();
