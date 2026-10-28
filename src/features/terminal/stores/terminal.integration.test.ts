/**
 * Tests for the terminal store's getTerminalScreen: a fake xterm buffer verifies
 * visible-viewport reads (viewportY offset, trailing blank-line trimming, cursor position, full-screen alt buffer).
 */
import { describe, it, expect } from 'vitest';
import type { Terminal } from '@xterm/xterm';
import { getTerminalScreen, registerTerminal, useTerminalStore } from '@features/terminal/stores/terminal';

function makeLine(text: string) {
  return { translateToString: () => text };
}

function fakeTerm(lines: string[], opts: {
  viewportY?: number; cursorY?: number; cursorX?: number; cols?: number; rows?: number;
} = {}) {
  const { viewportY = 0, cursorY = 0, cursorX = 0, cols = 80, rows = 24 } = opts;
  return {
    cols,
    rows,
    buffer: {
      active: {
        viewportY,
        length: lines.length,
        cursorY,
        cursorX,
        getLine: (i: number) => (i >= 0 && i < lines.length ? makeLine(lines[i]!) : undefined),
      },
    },
  } as unknown as Terminal;
}

describe('getTerminalScreen', () => {
  it('reads the visible viewport, trims trailing blank lines and adds line numbers', () => {
    useTerminalStore.setState({ scenes: { p1: 'classic' } });
    registerTerminal('p1', fakeTerm(['hello', 'world', '   '], { cursorY: 1, cursorX: 4, rows: 10 }));

    const s = getTerminalScreen('p1')!;
    expect(s.scene).toBe('classic');
    expect(s.cols).toBe(80);
    expect(s.rows).toBe(10);
    expect(s.cursorY).toBe(1);
    expect(s.cursorX).toBe(4);
    expect(s.content).toBe(' 1│hello\n 2│world');
  });

  it('viewportY offset: reads only the currently visible window lines', () => {
    useTerminalStore.setState({ scenes: { p1: 'classic' } });
    registerTerminal('p1', fakeTerm(['l0', 'l1', 'l2', 'l3', 'l4', 'l5'], {
      viewportY: 2, rows: 3,
    }));

    const s = getTerminalScreen('p1')!;
    expect(s.content).toBe(' 1│l2\n 2│l3\n 3│l4');
  });

  it('altScreen: viewportY=0, reads the whole alt buffer', () => {
    useTerminalStore.setState({ scenes: { p1: 'altScreen' } });
    registerTerminal('p1', fakeTerm(['vim 第1行', '~', '-- INSERT --'], { rows: 24 }));

    const s = getTerminalScreen('p1')!;
    expect(s.scene).toBe('altScreen');
    expect(s.content).toBe(' 1│vim 第1行\n 2│~\n 3│-- INSERT --');
  });

  it('returns null when there is no xterm instance', () => {
    useTerminalStore.setState({ scenes: {} });
    expect(getTerminalScreen('missing')).toBeNull();
  });
});
