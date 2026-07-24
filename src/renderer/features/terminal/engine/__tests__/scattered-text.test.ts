/**
 * Targeted reproduction: scattered-text pattern where each word's first
 * character appears at the far right of one line and the remaining
 * characters appear at the left of the next line.
 *
 * Observed pattern (each line shown as "left...right"):
 *   or                                                                             t
 *   he                                                                             b
 *   est                                                                            e
 *   xperience,                                                                     l
 *   aunch                                                                          i
 *
 * This happens when the PTY width ≠ buffer width, causing auto-wrap at
 * unexpected positions.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { TerminalBuffer } from '../buffer';
import type { TerminalEvent } from '../../../../../shared/terminal/events';

function lineStr(buf: TerminalBuffer, idx: number): string {
  return buf.lines[idx]?.cells.map(c => c.char).join('') ?? '';
}

function snapshot(buf: TerminalBuffer): string[] {
  return buf.lines.map(l => l.cells.map(c => c.char).join(''));
}

/** Find lines that have only 1-2 visible chars but are very long (scattered pattern). */
function findScattered(lines: string[], minLen = 30): string[] {
  return lines.filter(l => {
    const visible = l.replace(/\s/g, '');
    return visible.length > 0 && visible.length <= 3 && l.length > minLen;
  });
}

describe('Scattered text reproduction', () => {
  let buf: TerminalBuffer;

  beforeEach(() => { buf = new TerminalBuffer(); });

  // ──────────────────────────────────────────────────────────────────────
  // Scenario 1: Width mismatch — buffer narrower than PTY output
  //   When CHA targets a column beyond the buffer width, it's clamped
  //   to cols-1, triggering auto-wrap that scatters text.
  //   This is the MECHANISM that causes the issue when the buffer's
  //   initial width doesn't match the PTY.
  // ──────────────────────────────────────────────────────────────────────

  it('width mismatch: 80-col buffer processes 96-col PTY events', () => {
    // Simulate the BUG: buffer at 80 (old default), PTY at 96
    buf.resize(80);

    // Events formatted for 96-col terminal with CHA positioning
    const events96: TerminalEvent[] = [
      { t: 'J', p: 2 },
      { t: 'H', p: [1, 1] },
      { t: 'm', p: [1, 38, 5, 220] },
      { t: 'G', p: 2 },  { t: 'txt', p: 'for' },
      { t: 'G', p: 8 },  { t: 'txt', p: 'the' },
      { t: 'G', p: 14 }, { t: 'txt', p: 'best' },
      { t: 'G', p: 21 }, { t: 'txt', p: 'experience,' },
      { t: 'G', p: 35 }, { t: 'txt', p: 'launch' },
      { t: 'G', p: 44 }, { t: 'txt', p: 'it' },
      { t: 'G', p: 49 }, { t: 'txt', p: 'in' },
      // Wide CHA near the right edge of 96-col terminal → clamped at 80
      { t: 'G', p: 93 }, { t: 'txt', p: 'X' },
      { t: 'cr' }, { t: 'lf' },
    ];

    buf.applyEvents(events96);

    const lines = snapshot(buf);
    console.error('\n=== Width mismatch: 80-col buffer, 96-col events ===');
    console.error(`Total lines: ${lines.length}, cols: ${buf.cols}`);
    lines.slice(0, 10).forEach((l, i) => {
      const vis = l.replace(/\s/g, '');
      if (vis.length > 0) {
        console.error(`  [${i}] len=${l.length} vis="${vis}"`);
      }
    });

    // CHA(93) is clamped to col 79. 'X' at col 79 → should be at far right
    expect(lines[0][79]).toBe('X');
  });

  // ──────────────────────────────────────────────────────────────────────
  // Scenario 3: Auto-wrap behavior when cursor is at cols-1 before text
  //   If a preceding event leaves cx at cols-1, the next character
  //   triggers auto-wrap → character at far right, rest on next line.
  // ──────────────────────────────────────────────────────────────────────

  it('auto-wrap: character at cols-1 wraps to next line correctly', () => {
    buf.resize(40);

    // Position cursor at the last column
    buf.applyEvents([
      { t: 'G', p: 40 },         // CHA to col 40 (1-indexed) → cx = 39
      { t: 'txt', p: 'for' },    // 'f' at 39, 'o' wraps → next line, 'r' at 1
    ]);

    const lines = snapshot(buf);
    console.error('\n=== Auto-wrap at cols-1 ===');
    lines.slice(0, 5).forEach((l, i) => {
      console.error(`  [${i}] len=${l.length} content="${l.slice(0, 60)}"`);
    });

    // Line 0 should have 'f' at the far right (col 39)
    const line0 = lines[0];
    expect(line0.length).toBe(40);
    expect(line0[39]).toBe('f');

    // Line 1 should have 'or' at cols 0-1
    const line1 = lines[1];
    expect(line1[0]).toBe('o');
    expect(line1[1]).toBe('r');
  });

  // ──────────────────────────────────────────────────────────────────────
  // Scenario 4: Claude-like render where CHA positions text across full width
  //   Claude uses CHA to position text across the full column range.
  //   If a CHA positions to col `cols`, the next character triggers wrap.
  // ──────────────────────────────────────────────────────────────────────

  it('CHA to last column triggers auto-wrap on next char', () => {
    // Buffer and PTY both at 80
    buf.resize(80);

    // Simulate: CHA to col 80 (last col), write text
    // In 1-indexed: col 80 is the last column
    // In 0-indexed (cx): col 79
    buf.applyEvents([
      { t: 'H', p: [1, 1] },
      { t: 'G', p: 80 },        // CHA to last column → cx = 79
      { t: 'txt', p: 'Z' },     // 'Z' at col 79
      { t: 'cr' },
      { t: 'lf' },
      // Next line: text starts at col 1
      { t: 'G', p: 1 },
      { t: 'txt', p: 'next' },
    ]);

    const lines = snapshot(buf);
    console.error('\n=== CHA to col 80 → auto-wrap ===');
    lines.slice(0, 5).forEach((l, i) => {
      console.error(`  [${i}] len=${l.length} content="${l.slice(0, 80)}"`);
    });

    // 'Z' should be at line 0, col 79 (0-indexed)
    expect(lines[0][79]).toBe('Z');
    // 'next' should be on line 1
    expect(lines[1]).toContain('next');
  });

  // ──────────────────────────────────────────────────────────────────────
  // Scenario 5: Width mismatch during chunked event delivery
  //   Events generated for 96 cols, but buffer is at 80.
  //   CHA(90) → clamped to 79. Text at col 79 triggers wrap.
  // ──────────────────────────────────────────────────────────────────────

  it('wide CHA clamped to narrow buffer creates scattered pattern', () => {
    buf.resize(80); // buffer narrower than PTY

    // Events generated for 96-col terminal
    const wideEvents: TerminalEvent[] = [
      { t: 'H', p: [1, 1] },
      { t: 'txt', p: 'Status: ' },
      // CHA to col 90 in 96-col PTY → but buffer has only 80 cols
      // CHA(90) → (90 || 1) - 1 = 89 → clamped to min(79, 89) = 79
      { t: 'G', p: 90 },
      { t: 'txt', p: 'OK' },    // 'O' at col 79, 'K' wraps to next line
    ];

    buf.applyEvents(wideEvents);

    const lines = snapshot(buf);
    console.error('\n=== Wide CHA clamped (80-col buffer, 96-col events) ===');
    lines.slice(0, 10).forEach((l, i) => {
      console.error(`  [${i}] len=${l.length} content="${l.slice(0, 80)}"`);
    });

    const line0 = lines[0];
    // 'O' should be at the far right (col 79)
    expect(line0[79]).toBe('O');
    // 'K' should be at line 1, col 0
    expect(lines[1][0]).toBe('K');
  });

  // ──────────────────────────────────────────────────────────────────────
  // Scenario 6: Multiple words CHA-positioned near the right edge
  //   This is the closest to the real Claude rendering pattern.
  // ──────────────────────────────────────────────────────────────────────

  it('multiple CHA-positioned words near right edge at wrong width', () => {
    buf.resize(60); // buffer is narrower than the 96-col PTY output

    // Events formatted for 96-col terminal with CHA positioning
    const events: TerminalEvent[] = [
      { t: 'H', p: [2, 1] },
      // "for" at cols 78-80 → "for the best experience, launch it in"
      // Each word has its first char CHA-positioned near the right edge
      { t: 'G', p: 78 }, { t: 'txt', p: 'f' },
      { t: 'G', p: 79 }, { t: 'txt', p: 'o' },
      { t: 'G', p: 80 }, { t: 'txt', p: 'r' },
      { t: 'G', p: 82 }, { t: 'txt', p: 't' },
      { t: 'G', p: 83 }, { t: 'txt', p: 'h' },
      { t: 'G', p: 84 }, { t: 'txt', p: 'e' },
      // ... this is getting too contrived
    ];

    buf.applyEvents(events);
    // Just verify no crash/exception
    expect(buf.lines.length).toBeGreaterThan(0);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Scenario 7: Realistic scenario — initial buffer width is default 80,
  //   but PTY is created at a different width. The ResizeObserver hasn't
  //   fired yet, and the first PTY output arrives.
  // ──────────────────────────────────────────────────────────────────────

  it('initial width mismatch: PTY at 96, buffer at default 80, with inline text', () => {
    // Buffer starts at default 80 — no resize() called yet
    expect(buf.cols).toBe(80);

    // Simulate a shell prompt line + Claude TUI header
    // PTY is at 96, outputs a line that fills 96 cols
    const shellOutput: TerminalEvent[] = [
      // A divider line that fills the terminal width
      { t: 'txt', p: '─'.repeat(96) },
      { t: 'cr' }, { t: 'lf' },
      // Text with CHA positioning for 96 cols
      { t: 'G', p: 2 }, { t: 'txt', p: 'for' },
      { t: 'G', p: 90 }, { t: 'txt', p: 't' },
      { t: 'cr' }, { t: 'lf' },
    ];

    buf.applyEvents(shellOutput);

    const lines = snapshot(buf);
    console.error('\n=== Initial width mismatch 80 vs 96 ===');
    console.error(`Total lines: ${lines.length}, cols: ${buf.cols}`);
    lines.forEach((l, i) => {
      const vis = l.replace(/\s/g, '');
      if (vis.length > 0) {
        console.error(`  [${i}] len=${l.length} vis="${vis.slice(0, 80)}"`);
      }
    });

    // At 80 cols, the 96-wide divider line should wrap
    // Line 0 should have 80 dashes, line 1 should have 16 dashes
    expect(lines[0].length).toBe(80);
    expect(lines[1].length).toBe(16); // 96 - 80 = 16 dash chars from wrap
    expect(lines[1].replace(/\s/g, '')).toBe('─'.repeat(16));
  });
});
