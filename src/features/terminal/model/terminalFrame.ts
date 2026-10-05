import type { Terminal } from '@xterm/xterm';
import { extractSnapshotFromBuffer } from './terminalSnapshot';

export interface TerminalFrame {
  html: string;
  plainText: string;
  cols: number;
  rows: number;
}

export function captureFrame(term: Terminal): TerminalFrame {
  const buffer = term.buffer.active;
  const start = buffer.viewportY;
  const snapshot = extractSnapshotFromBuffer(buffer, term.cols, start, start + term.rows);
  return { ...snapshot, cols: term.cols, rows: term.rows };
}

export function needsSecretResponse(text: string): boolean {
  const lines = text.trimEnd().split('\n');
  const line = lines[lines.length - 1] ?? '';
  return /(?:password|passphrase|密码|口令)[^\n]*[:：]\s*$/i.test(line);
}
