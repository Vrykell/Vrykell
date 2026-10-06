import { describe, expect, it } from 'vitest';
import { createOffscreenTerm, extractSnapshotFromBuffer } from '../terminalSnapshot';

describe('snapshot rows with font metric compensation', () => {
  it.each([0.01, -0.01451])('trims trailing empty viewport rows with spacing %s', async spacing => {
    const { term, dispose } = createOffscreenTerm(80, 40);
    try {
      await new Promise<void>(resolve => term.write('notes.txt\r\n', resolve));
      const snapshot = extractSnapshotFromBuffer(term.buffer.active, term.cols, undefined, undefined, spacing);
      expect(snapshot.plainText).toBe('notes.txt');
      expect(snapshot.html).toContain('notes.txt');
      expect(snapshot.html).not.toContain('<br>');
    } finally { dispose(); }
  });

  it('preserves empty rows between output while removing trailing rows', async () => {
    const { term, dispose } = createOffscreenTerm(80, 40);
    try {
      await new Promise<void>(resolve => term.write('first\r\n\r\nsecond\r\n', resolve));
      const snapshot = extractSnapshotFromBuffer(term.buffer.active, term.cols, undefined, undefined, -0.01451);
      expect(snapshot.plainText).toBe('first\n\nsecond');
      expect(snapshot.html.match(/<br>/g)).toHaveLength(2);
    } finally { dispose(); }
  });
});
