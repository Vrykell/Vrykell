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

/** Native rendering stays in the terminal; only authentication changes need a React snapshot. */
export function captureConnectionFrame(term: Terminal, previous: TerminalFrame | null, disconnected = false): TerminalFrame {
  const buffer = term.buffer.active;
  const lines: string[] = [];
  for (let row = buffer.viewportY; row < buffer.viewportY + term.rows; row++) {
    lines.push(buffer.getLine(row)?.translateToString(true) ?? '');
  }
  const text = lines.join('\n');
  const prompt = secretResponsePrompt(text);
  if (!disconnected && prompt === null) {
    if (previous?.html === '' && previous.cols === term.cols && previous.rows === term.rows) return previous;
    return { html: '', plainText: '', cols: term.cols, rows: term.rows };
  }
  if (!disconnected && previous && prompt === secretResponsePrompt(previous.plainText)
    && secretResponseWasRejected(text) === secretResponseWasRejected(previous.plainText)
    && previous.cols === term.cols && previous.rows === term.rows) return previous;
  return captureFrame(term);
}

export function secretResponsePrompt(text: string): string | null {
  const lines = text.trimEnd().split('\n');
  const line = lines[lines.length - 1]?.trim() ?? '';
  return /(?:password|passphrase|密码|口令)[^\n]*[:：]\s*$/i.test(line) ? line : null;
}

export function needsSecretResponse(text: string): boolean {
  return secretResponsePrompt(text) !== null;
}

export function secretResponseWasRejected(text: string): boolean {
  const lines = text.trimEnd().split('\n').map(line => line.trim()).filter(Boolean);
  const previous = lines.length > 1 ? lines[lines.length - 2]! : '';
  return /(?:permission denied|authentication failed|incorrect (?:password|passphrase)|密码错误|认证失败|请重试)/i.test(previous);
}
