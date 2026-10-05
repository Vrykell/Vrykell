import { describe, expect, it } from 'vitest';
import { createBlockTerm } from '../model/terminalSnapshot';
import { measureRunningTerminalRows } from '../model/runningTerminalRows';

describe('running terminal height', () => {
  it('keeps its occupied rows when an interactive program clears and repaints its input', async () => {
    const block = createBlockTerm(80, 24);
    try {
      await new Promise<void>(resolve => block.term.write('\x1b[20;1Hinput', resolve));
      const occupied = measureRunningTerminalRows(block.term.buffer.active, 24, 1);
      expect(occupied).toBe(20);
      await new Promise<void>(resolve => block.term.write('\x1b[H\x1b[2Jrepainting', resolve));
      expect(measureRunningTerminalRows(block.term.buffer.active, 24, occupied)).toBe(20);
      await new Promise<void>(resolve => block.term.write('\x1b[22;1Hinput a', resolve));
      expect(measureRunningTerminalRows(block.term.buffer.active, 24, occupied)).toBe(22);
      expect(measureRunningTerminalRows(block.term.buffer.active, 12, occupied)).toBe(12);
    } finally { block.dispose(); }
  });

  it('starts compact and includes populated rows below the cursor', async () => {
    const block = createBlockTerm(80, 24);
    try {
      expect(measureRunningTerminalRows(block.term.buffer.active, 24, 1)).toBe(1);
      await new Promise<void>(resolve => block.term.write('\x1b[10;1Hstatus\x1b[H', resolve));
      expect(measureRunningTerminalRows(block.term.buffer.active, 24, 1)).toBe(10);
    } finally { block.dispose(); }
  });
});
