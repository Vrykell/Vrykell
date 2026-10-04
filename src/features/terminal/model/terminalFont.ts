/** Shared font metrics for the terminal canvas and block snapshots. */
import { useTypographyStore } from '@config/typography';
export const TERMINAL_FONT_FAMILY =
  'Menlo, Monaco, "Cascadia Code", "JetBrains Mono", "Noto Sans Mono", "DejaVu Sans Mono", "Noto Sans CJK SC", "PingFang SC", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", monospace';

export function getTerminalFontSize(): number { return useTypographyStore.getState().terminalFontSize; }
export const TERMINAL_LINE_HEIGHT = 1.0;
