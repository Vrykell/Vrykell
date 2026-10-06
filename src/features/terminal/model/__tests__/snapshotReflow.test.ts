import { describe, expect, it } from 'vitest';
import { Terminal } from '@xterm/xterm';
import { extractSnapshotFromBuffer } from '../terminalSnapshot';

describe('completed terminal row reflow', () => {
  it('joins only terminal soft wraps, preserving spaces, explicit newlines and colors', async () => {
    const term = new Terminal({ cols: 6, rows: 8 });
    try {
      await new Promise<void>(resolve => term.write('\x1b[32mabc   defghi\x1b[0m\r\nnext', resolve));
      const fixed = extractSnapshotFromBuffer(term.buffer.active, term.cols);
      const flowing = extractSnapshotFromBuffer(term.buffer.active, term.cols, undefined, undefined, 0, true);
      expect(fixed.plainText).toBe('abc   \ndefghi\nnext');
      expect(flowing.plainText).toBe('abc   defghi\nnext');
      expect(flowing.html.match(/<br>/g)).toHaveLength(1);
      expect(flowing.html).toContain('abc   ');
      expect(flowing.html).toContain('color:');
    } finally { term.dispose(); }
  });

  it('preserves explicit blank rows and double-width characters in a wrapped line', async () => {
    const term = new Terminal({ cols: 4, rows: 8 });
    try {
      await new Promise<void>(resolve => term.write('你好世界\r\n\r\nend', resolve));
      const snapshot = extractSnapshotFromBuffer(term.buffer.active, term.cols, undefined, undefined, 0, true);
      expect(snapshot.plainText).toBe('你好世界\n\nend');
      expect(snapshot.html.match(/width:2ch/g)).toHaveLength(4);
      expect(snapshot.html.match(/<br>/g)).toHaveLength(2);
    } finally { term.dispose(); }
  });

  it('keeps viewport snapshots as physical rows for authentication and screen capture', async () => {
    const term = new Terminal({ cols: 4, rows: 8 });
    try {
      await new Promise<void>(resolve => term.write('abcdefgh', resolve));
      const snapshot = extractSnapshotFromBuffer(term.buffer.active, term.cols);
      expect(snapshot.plainText).toBe('abcd\nefgh');
      expect(snapshot.html).toBe('abcd<br>efgh');
    } finally { term.dispose(); }
  });

  it('does not insert empty grid padding before a wrapped double-width glyph', async () => {
    const term = new Terminal({ cols: 3, rows: 8 });
    try {
      await new Promise<void>(resolve => term.write('你好世界', resolve));
      const snapshot = extractSnapshotFromBuffer(term.buffer.active, term.cols, undefined, undefined, 0, true);
      expect(snapshot.plainText).toBe('你好世界');
      expect(snapshot.html.replace(/<[^>]*>/g, '')).toBe('你好世界');
    } finally { term.dispose(); }
  });
});
