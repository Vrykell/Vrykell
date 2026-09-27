/**
 * termMetrics — xterm 渲染尺寸读取（字符宽/行高 px）。
 *
 * xterm 未暴露公开 API，尺寸需读私有 `_core._renderService.dimensions`；
 * 全应用统一走这里（曾有三处各自内联，升级 xterm 时需同步多处）。
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
