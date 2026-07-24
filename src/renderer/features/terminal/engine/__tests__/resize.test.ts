/**
 * Test terminal resize behaviour: column width changes must not corrupt output.
 *
 * Problem observed: when widening the terminal by dragging the window border,
 * Claude's TUI text gets scattered across lines — characters appear far apart
 * vertically, as if the cursor position drifts.
 *
 * Hypotheses to test:
 *   A. resize(cols) corrupts existing line content
 *   B. resize(cols) doesn't update cx bound, causing putChar to write past cols
 *   C. Text written at old width, then new text at new width, overlap wrong
 *   D. CJK wide chars misalign after resize
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { TerminalBuffer } from '../buffer';

function lineText(buf: TerminalBuffer, idx: number): string {
  return buf.lines[idx]?.cells.map(c => c.char).join('') ?? '';
}

describe('Terminal resize', () => {
  let buf: TerminalBuffer;

  beforeEach(() => {
    buf = new TerminalBuffer();
  });

  // ── A: Existing content survives resize ─────────────────────────────────

  it('existing content is unchanged after resize wider', () => {
    buf.resize(40);
    buf.write('short line\n');
    const before = lineText(buf, 0);

    buf.resize(100);
    const after = lineText(buf, 0);

    expect(after).toBe(before); // existing lines not touched
  });

  it('existing content is unchanged after resize narrower', () => {
    buf.resize(80);
    buf.write('a somewhat longer line of text\n');
    const before = lineText(buf, 0);

    buf.resize(40);
    const after = lineText(buf, 0);

    expect(after).toBe(before); // existing lines not touched
  });

  // ── B: New text honours new width ───────────────────────────────────────

  it('text written after resize wider fills up to new width', () => {
    buf.resize(40);
    buf.write('first\n');

    buf.resize(80);
    buf.write('X'.repeat(70) + '\n');

    // The second line should be 70 X's, not truncated at 40
    const second = lineText(buf, 1);
    expect(second.length).toBeGreaterThanOrEqual(70);
  });

  it('text written after resize narrower wraps at new width', () => {
    buf.resize(80);
    buf.write('first\n');

    buf.resize(20);
    // Write 30 X's — should wrap at column 20
    buf.write('X'.repeat(30) + '\n');

    const second = lineText(buf, 1);
    expect(second.length).toBe(20);
    // Wrapped portion on next line (after \n moves to line 3, content is on line 2)
    const third = lineText(buf, 2);
    expect(third.length).toBe(15);
  });

  // ── C: Cursor position after resize ────────────────────────────────────

  it('cursor position resets to new bounds after resize wider', () => {
    buf.resize(40);
    buf.write('some text'); // cx = 9
    expect(buf.cx).toBe(9);

    // Resize wider — cursor stays at its current position
    buf.resize(80);
    expect(buf.cx).toBe(9);

    // Cursor can now move past old width
    buf.write('X'.repeat(70));
    expect(buf.cx).toBe(79); // 9 + 70 = 79
  });

  it('cursor at old width edge stays valid after resize narrower', () => {
    buf.resize(80);
    buf.write('X'.repeat(79)); // cx = 79, at right edge
    expect(buf.cx).toBe(79);

    // Resize narrower — cursor was at 79, new width is 40
    buf.resize(40);

    // After the fix: resize clamps cx to new cols-1
    const afterResizeCx = buf.cx;
    expect(afterResizeCx).toBeLessThanOrEqual(buf.cols - 1);
    expect(afterResizeCx).toBe(39); // clamped from 79 to 40-1
  });

  // ── D: Resize with CJK characters ──────────────────────────────────────

  it('CJK chars at boundary survive resize', () => {
    // 12 (not 10): at exactly cols=10, writing 10 columns of content leaves
    // the cursor clamped at cols-1 with pendingWrap (standard terminal
    // semantics), which is not what this test exercises.
    buf.resize(12);

    // Write 你好 at columns 8-9 (fits exactly at 2-wide each)
    buf.write('123456\u{4f60}\u{597d}'); // 6 ascii + 你(2) + 好(2) = 10 cols
    expect(buf.cx).toBe(10);

    // Resize to 20 — existing content unchanged
    buf.resize(20);
    const line = lineText(buf, 0);
    expect(line).toContain('\u{4f60}');
    expect(line).toContain('\u{597d}');
  });

  // ── E: Rapid resize does not corrupt new output ────────────────────────

  it('rapid resize + write cycle does not produce garbled text', () => {
    // Simulate: user drags window border, terminal resizes multiple times,
    // then new output arrives
    buf.resize(80);
    buf.write('line at 80\n');

    buf.resize(60);
    buf.resize(70);
    buf.resize(90);
    buf.resize(100);

    // Write new text — should use final width (100)
    const text = 'A'.repeat(90);
    buf.write('\x1b[2;1H' + text); // CUP to line 2, col 1, then wide text
    const result = lineText(buf, 1);
    expect(result.length).toBeGreaterThanOrEqual(90);
    // All characters should be 'A' — no garbage
    expect(result.trim()).toBe('A'.repeat(90));
  });
});

describe('resize reflow (soft-wrap rewrapping)', () => {
  let buf: TerminalBuffer;

  beforeEach(() => {
    buf = new TerminalBuffer();
  });

  const text = (buf: TerminalBuffer) =>
    buf.lines.map((l) => l.cells.map((c) => c.char).join('')).join('\n');

  it('rewraps a soft-wrapped line when narrowing', () => {
    buf.resize(80);
    buf.write('X'.repeat(150)); // 80 + 70 across two soft-wrapped lines
    expect(buf.lines[1].wrapped).toBe(true);

    buf.resize(40);
    expect(lineText(buf, 0)).toBe('X'.repeat(40));
    expect(lineText(buf, 1)).toBe('X'.repeat(40));
    expect(lineText(buf, 2)).toBe('X'.repeat(40));
    expect(lineText(buf, 3)).toBe('X'.repeat(30));
    expect(buf.lines[1].wrapped).toBe(true);
    expect(buf.lines[3].wrapped).toBe(true);
  });

  it('rejoins soft-wrapped lines when widening', () => {
    buf.resize(40);
    buf.write('Y'.repeat(100)); // 40 + 40 + 20
    buf.resize(80);
    expect(lineText(buf, 0)).toBe('Y'.repeat(80));
    expect(lineText(buf, 1)).toBe('Y'.repeat(20));
    expect(lineText(buf, 2)).toBe('');
  });

  it('preserves hard newlines', () => {
    buf.resize(80);
    buf.write('aaa\r\nbbb');
    buf.resize(40);
    expect(lineText(buf, 0)).toBe('aaa');
    expect(lineText(buf, 1)).toBe('bbb');
    expect(buf.lines[1].wrapped).toBeFalsy();
  });

  it('reflows scrollback, not just the visible screen', () => {
    buf.resize(80);
    buf.write('S'.repeat(150) + '\r\n'); // long line destined for scrollback
    for (let i = 0; i < buf.rows + 5; i++) buf.write(`filler-${i}\r\n`);
    expect(buf.lines.length).toBeGreaterThan(buf.rows);

    buf.resize(40);
    const all = text(buf);
    expect(all).toContain('S'.repeat(40));
    expect(buf.lines.length).toBeGreaterThan(buf.rows); // still scrolled
    // The S-run is now 4 visual lines; all S content preserved.
    expect((all.match(/S/g) ?? []).length).toBe(150);
  });

  it('never splits a wide (CJK) character across the new boundary', () => {
    buf.resize(40);
    buf.write('你'.repeat(25)); // 50 cols worth: 20 on line 0, 5 on line 1
    buf.resize(30);
    const all = text(buf);
    expect((all.match(/你/g) ?? []).length).toBe(25);
    for (const line of buf.lines) {
      line.cells.forEach((c, i) => {
        if (c.wide) expect(line.cells[i - 1]?.char).toBe('你');
      });
    }
  });

  it('keeps the cursor on its logical position after reflow', () => {
    buf.resize(80);
    buf.write('prompt$ ' + 'Z'.repeat(100)); // 8 + 100 = 108 cols: 80 + 28
    expect(buf.cx).toBe(28);
    buf.resize(40);
    expect(buf.cx).toBe(108 % 40); // 28
    expect(buf.cy).toBe(Math.floor(108 / 40)); // 2
    expect(lineText(buf, buf.cy)).toBe('Z'.repeat(28));
  });

  it('round-trips narrow → wide → narrow without losing content', () => {
    buf.resize(80);
    const msg = 'The quick brown fox jumps over the lazy dog. '.repeat(6); // 270 chars
    buf.write(msg);
    buf.resize(40);
    buf.resize(80);
    const joined = buf.lines.map((l) => l.cells.map((c) => c.char).join('')).join('');
    expect(joined.startsWith(msg)).toBe(true);
  });
});
