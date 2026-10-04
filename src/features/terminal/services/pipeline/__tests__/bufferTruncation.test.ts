import { describe, expect, it } from 'vitest';
import { createOffscreenTerm } from '@features/terminal/model/terminalSnapshot';
import { trackBufferTruncation } from '../bufferTruncation';

describe('buffer truncation tracking', () => {
  it('counts only discarded rows, including a single oversized write', async () => {
    const { term, dispose } = createOffscreenTerm(80, 3, 5);
    let lost = 0;
    const tracker = trackBufferTruncation(term, lines => { lost += lines; });
    try {
      await new Promise<void>(resolve => term.write('a\r\nb\r\nc\r\nd\r\n', resolve));
      expect(term.buffer.active.baseY).toBeGreaterThan(0);
      expect(lost).toBe(0);
      await new Promise<void>(resolve => term.write('e\r\nf\r\ng\r\nh\r\ni\r\nj\r\n', resolve));
      expect(lost).toBe(3);
      term.scrollToTop();
      term.scrollToBottom();
      expect(lost).toBe(3);
    } finally { tracker.dispose(); dispose(); }
  });

  it('does not confuse width reflow with discarded output', async () => {
    const { term, dispose } = createOffscreenTerm(20, 3, 200);
    let lost = 0;
    const tracker = trackBufferTruncation(term, lines => { lost += lines; });
    try {
      await new Promise<void>(resolve => term.write(`${'x'.repeat(160)}\r\n`, resolve));
      tracker.pause();
      term.resize(80, 3);
      tracker.resume();
      await new Promise<void>(resolve => term.write('tail\r\n', resolve));
      expect(lost).toBe(0);
    } finally { tracker.dispose(); dispose(); }
  });
});
