/**
 * termMetrics — reads renderer cell metrics (character width / row height in px).
 *
 * The terminal library exposes no public API for this, so the size is read from the
 * private `_core._renderService.dimensions`; keep that access here so every caller reads
 * it the same way.
 */
import type { Terminal } from '@xterm/xterm';

export interface TermCellMetrics {
  width: number;
  height: number;
}

/** Read renderer cell dimensions; use the default font's measured row height as fallback. */
export function getCellMetrics(term: Terminal): TermCellMetrics {
  const dims = (term as unknown as {
    _core?: { _renderService?: { dimensions?: { css?: { cell?: { width?: number; height?: number } } } } };
  })._core?._renderService?.dimensions;
  return {
    width: dims?.css?.cell?.width || 7.8,
    height: dims?.css?.cell?.height || 16,
  };
}
