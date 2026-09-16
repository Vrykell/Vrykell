/**
 * terminal store 的 getTerminalScreen 测试：用假 xterm buffer 验证
 * 可见视口读取（viewportY 偏移、尾部空行裁剪、光标位置、alt buffer 全屏）。
 */
import { describe, it, expect } from 'vitest';
import type { Terminal } from '@xterm/xterm';
import { getTerminalScreen, registerTerminal, useTerminalStore } from '@/store/terminal';

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
  it('读取可见视口并裁剪尾部空行，带行号', () => {
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

  it('viewportY 偏移：只读当前可见的窗口行', () => {
    useTerminalStore.setState({ scenes: { p1: 'classic' } });
    registerTerminal('p1', fakeTerm(['l0', 'l1', 'l2', 'l3', 'l4', 'l5'], {
      viewportY: 2, rows: 3,
    }));

    const s = getTerminalScreen('p1')!;
    expect(s.content).toBe(' 1│l2\n 2│l3\n 3│l4');
  });

  it('altScreen：viewportY=0，读满整个 alt buffer', () => {
    useTerminalStore.setState({ scenes: { p1: 'altScreen' } });
    registerTerminal('p1', fakeTerm(['vim 第1行', '~', '-- INSERT --'], { rows: 24 }));

    const s = getTerminalScreen('p1')!;
    expect(s.scene).toBe('altScreen');
    expect(s.content).toBe(' 1│vim 第1行\n 2│~\n 3│-- INSERT --');
  });

  it('无 xterm 实例返回 null', () => {
    useTerminalStore.setState({ scenes: {} });
    expect(getTerminalScreen('missing')).toBeNull();
  });
});
