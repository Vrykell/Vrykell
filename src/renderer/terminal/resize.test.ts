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
import { TerminalBuffer } from './buffer';

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
    buf.resize(10);

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
