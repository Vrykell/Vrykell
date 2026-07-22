import { describe, it, expect } from 'vitest';
import { TerminalBuffer } from './buffer';

describe('TerminalBuffer', () => {
  it('writes plain text and advances cursor', () => {
    const buf = new TerminalBuffer();
    buf.write('hello');
    expect(buf.cx).toBe(5);
    expect(buf.cy).toBe(0);
    expect(buf.lines[0].cells.map((c) => c.char).join('')).toBe('hello');
  });

  it('handles CR/LF/BS/TAB', () => {
    const buf = new TerminalBuffer();
    buf.write('a\nb\nc'); // LF moves down but does NOT reset cx
    expect(buf.cy).toBe(2);
    expect(buf.cx).toBe(3);

    const b2 = new TerminalBuffer();
    b2.write('abc\rxy');
    expect(b2.lines[0].cells.map((c) => c.char).join('')).toBe('xyc');

    const b3 = new TerminalBuffer();
    b3.write('abc\b');
    expect(b3.cx).toBe(2);
  });

  it('applies SGR colors and resets', () => {
    const buf = new TerminalBuffer();
    buf.write('\x1b[31mred\x1b[0mplain');
    expect(buf.lines[0].cells[0].fg).toBe('#cd3131');
    expect(buf.lines[0].cells[3].fg).toBeUndefined();
  });

  it('applies bold/italic/underline', () => {
    const buf = new TerminalBuffer();
    buf.write('\x1b[1;3;4mX');
    const cell = buf.lines[0].cells[0];
    expect(cell.bold).toBe(true);
    expect(cell.italic).toBe(true);
    expect(cell.underline).toBe(true);
  });

  it('moves cursor with CUP', () => {
    const buf = new TerminalBuffer();
    buf.write('\x1b[10;20H');
    expect(buf.cy).toBe(9);
    expect(buf.cx).toBe(19);
  });

  it('moves cursor with CUU/CUD/CUF/CUB', () => {
    const buf = new TerminalBuffer();
    buf.write('\x1b[5;5H'); // cy=4, cx=4
    buf.write('\x1b[2A');   // cy=2
    buf.write('\x1b[3B');   // cy=5
    buf.write('\x1b[4C');   // cx=8 (capped at cols-1)
    buf.write('\x1b[2D');   // cx=6
    expect(buf.cy).toBe(5);
    expect(buf.cx).toBe(6);
  });

  it('clears screen with ED 2', () => {
    const buf = new TerminalBuffer();
    buf.write('line1\nline2\nline3');
    buf.write('\x1b[2J');
    expect(buf.lines.length).toBe(1);
    expect(buf.lines[0].cells.length).toBe(0);
    expect(buf.cx).toBe(0);
    expect(buf.cy).toBe(0);
  });

  it('erases line with EL 2', () => {
    const buf = new TerminalBuffer();
    buf.write('hello world');
    buf.write('\x1b[5D\x1b[2K');
    expect(buf.lines[0].cells.map((c) => c.char).join('')).toBe('');
  });

  it('saves and restores cursor', () => {
    const buf = new TerminalBuffer();
    buf.write('\x1b[5;10H');
    buf.write('\x1b[s');
    buf.write('\x1b[1;1H');
    buf.write('\x1b[u');
    expect(buf.cy).toBe(4);
    expect(buf.cx).toBe(9);
  });

  it('buffers split CSI across writes', () => {
    const buf = new TerminalBuffer();
    buf.write('\x1b[31');
    buf.write('mred');
    expect(buf.lines[0].cells[0].fg).toBe('#cd3131');
  });

  it('buffers split OSC across writes', () => {
    const buf = new TerminalBuffer();
    buf.write('\x1b]0;half');
    buf.write('title\x07');
    expect(buf.lines[0].cells.length).toBe(0);
  });

  it('defers wrap at last column', () => {
    const buf = new TerminalBuffer();
    buf.resize(11); // resize() requires cols > 10
    buf.write('1234567890x'); // 11th char lands on last column (index 10)
    expect(buf.cx).toBe(10);
    expect(buf.pendingWrap).toBe(true);
    buf.write('y'); // wrap only happens when the NEXT char arrives
    expect(buf.cy).toBe(1);
    expect(buf.cx).toBe(1);
  });

  it('disables autowrap with DECAWM reset', () => {
    const buf = new TerminalBuffer();
    buf.resize(11);
    buf.write('\x1b[?7l1234567890xy');
    expect(buf.cy).toBe(0);
    // Without autowrap, cursor stays on last column; later chars overwrite it
    expect(buf.cx).toBe(10);
    expect(buf.lines[0].cells[10].char).toBe('y');
  });

  it('toggles cursor visibility', () => {
    const buf = new TerminalBuffer();
    buf.write('\x1b[?25l');
    expect(buf.cursorVisible).toBe(false);
    buf.write('\x1b[?25h');
    expect(buf.cursorVisible).toBe(true);
  });

  it('clears via clear()', () => {
    const buf = new TerminalBuffer();
    buf.write('abc');
    buf.clear();
    expect(buf.lines.length).toBe(1);
    expect(buf.lines[0].cells.length).toBe(0);
    expect(buf.cx).toBe(0);
  });
});
