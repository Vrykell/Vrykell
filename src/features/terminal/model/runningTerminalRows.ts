import type { IBuffer } from '@xterm/xterm';

/** Keep occupied rows while a running program clears and repaints its screen. */
export function measureRunningTerminalRows(buffer: IBuffer, rows: number, previous: number): number {
  let contentEnd = buffer.baseY + buffer.cursorY + 1;
  const bottom = Math.min(buffer.baseY + rows, buffer.length);
  for (let y = bottom - 1; y >= 0; y--) {
    if (buffer.getLine(y)?.translateToString(true).trim()) {
      contentEnd = Math.max(contentEnd, y + 1);
      break;
    }
  }
  return Math.max(1, Math.min(Math.max(previous, contentEnd), rows));
}
