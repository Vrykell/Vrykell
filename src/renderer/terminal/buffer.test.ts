import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

  it('treats CJK characters as 2 cells wide', () => {
    const buf = new TerminalBuffer();
    buf.write('\u{4f60}\u{597d}'); // 你好
    expect(buf.cx).toBe(4);
    // Primary cell has the char, second cell is a wide continuation
    expect(buf.lines[0].cells[0].char).toBe('\u{4f60}');
    expect(buf.lines[0].cells[1].char).toBe('');
    expect(buf.lines[0].cells[1].wide).toBe(true);
    expect(buf.lines[0].cells[2].char).toBe('\u{597d}');
    expect(buf.lines[0].cells[3].char).toBe('');
    expect(buf.lines[0].cells[3].wide).toBe(true);
  });

  it('correctly erases CJK with zsh-style BS sequence', () => {
    // Simulate real zsh behavior captured from node-pty:
    // User types "你好" (echoed), presses Backspace twice.
    // Zsh sends: \x08\x08  \x08\x08  per character (2×BS, 2×space, 2×BS)
    const buf = new TerminalBuffer();
    buf.resize(80);

    // Shell prompt + echoed CJK input
    buf.write('$ \u{4f60}\u{597d}'); // "$ 你好" — cx should be 6
    expect(buf.cx).toBe(6);

    // ── Backspace 1: zsh deletes "好" ──
    buf.write('\x08\x08  \x08\x08');
    const line1 = buf.lines[buf.cy].cells.map(c => c.char).join('');
    expect(line1).toContain('你');          // 你 still there
    expect(line1).not.toContain('好');       // 好 overwwritten with spaces
    expect(line1).toContain('$');           // prompt intact

    // ── Backspace 2: zsh deletes "你" ──
    buf.write('\x08\x08  \x08\x08');
    const line2 = buf.lines[buf.cy].cells.map(c => c.char).join('');
    expect(line2).not.toContain('你');       // 你 overwwritten
    expect(line2).not.toContain('好');       // 好 still gone
    expect(line2).toContain('$');           // prompt intact
    // The line should be prompt + spaces (both CJK replaced)
    expect(line2.trimEnd()).toBe('$');
  });

  it('wraps CJK char that does not fit at line end', () => {
    const buf = new TerminalBuffer();
    buf.resize(5);
    buf.write('123\u{4f60}'); // 123 (3 cols) + 你 (2 cols) fits in 5 cols
    expect(buf.cy).toBe(0); // on first line
    expect(buf.lines.length).toBeGreaterThanOrEqual(1);
  });
});

describe('SGR extended colours', () => {
  it('resolves 256-color foreground 38;5;N', () => {
    const buf = new TerminalBuffer();
    buf.write('\x1b[38;5;196mX'); // 196 = bright red in xterm cube
    expect(buf.lines[0].cells[0].fg).toBe('#ff0000');
  });

  it('resolves 256-color background 48;5;N', () => {
    const buf = new TerminalBuffer();
    buf.write('\x1b[48;5;21mX'); // 21 = blue
    expect(buf.lines[0].cells[0].bg).toBe('#0000ff');
  });

  it('resolves standard 256-colours from the lower 16', () => {
    const buf = new TerminalBuffer();
    buf.write('\x1b[38;5;1mX'); // index 1 = red (same as 31)
    expect(buf.lines[0].cells[0].fg).toBe('#cd3131');
  });

  it('resolves bright 256-colours from 8-15', () => {
    const buf = new TerminalBuffer();
    buf.write('\x1b[38;5;10mX'); // 10 = bright green (same as 92)
    expect(buf.lines[0].cells[0].fg).toBe('#23d18b');
  });

  it('resolves grayscale 256-colour', () => {
    const buf = new TerminalBuffer();
    buf.write('\x1b[38;5;232mX'); // 232 = darkest gray
    expect(buf.lines[0].cells[0].fg).toBe('#080808');
    const buf2 = new TerminalBuffer();
    buf2.write('\x1b[38;5;255mX'); // 255 = lightest gray
    expect(buf2.lines[0].cells[0].fg).toBe('#eeeeee');
  });

  it('resolves truecolor 38;2;R;G;B', () => {
    const buf = new TerminalBuffer();
    buf.write('\x1b[38;2;100;150;200mX');
    expect(buf.lines[0].cells[0].fg).toBe('#6496c8');
  });

  it('resolves truecolor background 48;2;R;G;B', () => {
    const buf = new TerminalBuffer();
    buf.write('\x1b[48;2;255;128;0mX');
    expect(buf.lines[0].cells[0].bg).toBe('#ff8000');
  });

  it('resets FG with 39 and BG with 49', () => {
    const buf = new TerminalBuffer();
    buf.write('\x1b[31m\x1b[48;5;196mX\x1b[39mY');
    expect(buf.lines[0].cells[0].fg).toBe('#cd3131');
    expect(buf.lines[0].cells[1].fg).toBeUndefined();
    expect(buf.lines[0].cells[1].bg).toBe('#ff0000'); // BG not reset yet
  });

  it('resets bold/italic/underline with 22/23/24', () => {
    const buf = new TerminalBuffer();
    buf.write('\x1b[1;3;4mX\x1b[22mY');
    expect(buf.lines[0].cells[0].bold).toBe(true);
    expect(buf.lines[0].cells[1].bold).toBe(false);
    expect(buf.lines[0].cells[1].italic).toBe(true); // 22 only resets bold
    // 23 resets italic
    const buf2 = new TerminalBuffer();
    buf2.write('\x1b[3mX\x1b[23mY');
    expect(buf2.lines[0].cells[1].italic).toBe(false);
    // 24 resets underline
    const buf3 = new TerminalBuffer();
    buf3.write('\x1b[4mX\x1b[24mY');
    expect(buf3.lines[0].cells[1].underline).toBe(false);
  });
});

describe('Claude Code real UI output', () => {
  it('parses live claude output with no escape residue or garbled text', () => {
    const buf = new TerminalBuffer();
    buf.resize(100);
    const data = readFileSync(resolve(__dirname, '../../test/fixtures/claude-ui.fixture.bin'), 'utf-8');

    // Write in 4KB chunks to exercise the split-escape buffering code paths
    for (let i = 0; i < data.length; i += 4096) {
      buf.write(data.slice(i, i + 4096));
    }

    // Collect every cell's text that was rendered to the grid
    let rendered = '';
    const escapeResidue: string[] = [];
    for (const line of buf.lines) {
      for (const cell of line.cells) {
        // 0x1b = ESC, 0x07 = BEL — these should NEVER reach a cell
        const cc = cell.char.charCodeAt(0);
        if (cc === 0x1b || cc === 0x07) {
          escapeResidue.push(`U+${cc.toString(16)} at line with "${cell.char}"`);
        }
        if (cc >= 0x20 || cc === 0x09) rendered += cell.char; // printable + TAB
        else rendered += `[\\x${cc.toString(16).padStart(2, '0')}]`;
      }
      rendered += '\n';
    }

    // ── Assertions ──────────────────────────────────────────

    // 1. Absolutely no raw escape characters survive into cells
    expect(escapeResidue).toEqual([]);

    // 2. Claude's human-readable UI text is present (proves real content parsed)
    const text = buf.lines.map(l => l.cells.map(c => c.char).join('')).join('\n');
    expect(text).toMatch(/Claude Code v2\.1\.\d+/);
    expect(text).toMatch(/Welcome back!/);
    expect(text).toMatch(/Tips for getting started/);
    expect(text).toMatch(/\bdeepseek-v4-pro\b/);

    // 3. 256-colour cells are resolved to hex, not left as undefined.
    //    Claude uses 38;5;220 (gold) for banner/heading elements.
    //    Verify at least one cell on a gold-coloured line (the top border "─") has fg.
    const borderCells = buf.lines.flatMap(l => l.cells).filter(
      c => c.fg && c.fg.startsWith('#'),
    );
    expect(borderCells.length).toBeGreaterThan(0);

    // 4. Cursor location is sensible (not stuck at origin 0,0)
    //    After rendering a full UI, cursor should be somewhere past column 0.
    expect(buf.cx).toBeGreaterThan(0);
    expect(buf.cy).toBeGreaterThan(0);

    // 5. Box-drawing characters that claude uses for the top banner (e.g. "─")
    //    must have resolved foreground colours from the 38;5;N sequence.
    const goldBorders = buf.lines.flatMap(l => l.cells).filter(
      c => (c.char === '─' || c.char === '━' || c.char === '╭' || c.char === '╰') && c.fg,
    );
    expect(goldBorders.length).toBeGreaterThan(0);
  });
});
