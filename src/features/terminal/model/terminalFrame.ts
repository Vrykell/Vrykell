import type { Terminal } from '@xterm/xterm';
import { extractSnapshotFromBuffer } from './terminalSnapshot';
import { getCellMetrics } from '@utils/termMetrics';

export interface TerminalFrame {
  html: string;
  plainText: string;
  cols: number;
  rows: number;
  cursorX: number;
  cursorY: number;
  cellWidth: number;
  cellHeight: number;
}

export function captureFrame(term: Terminal): TerminalFrame {
  const buffer = term.buffer.active;
  const start = buffer.viewportY;
  const snapshot = extractSnapshotFromBuffer(buffer, term.cols, start, start + term.rows);
  const metrics = getCellMetrics(term);
  return { ...snapshot, cols: term.cols, rows: term.rows, cursorX: buffer.cursorX,
    cursorY: buffer.baseY + buffer.cursorY - start, cellWidth: metrics.width, cellHeight: metrics.height };
}

export function needsSecretResponse(text: string): boolean {
  const lines = text.trimEnd().split('\n');
  const line = lines[lines.length - 1] ?? '';
  return /(?:password|passphrase|密码|口令)[^\n]*[:：]\s*$/i.test(line);
}
