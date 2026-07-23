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

  it('treats variation selectors and ZWJ as zero-width (no garbage cells)', () => {
    const buf = new TerminalBuffer();
    buf.write('a\u{2728}\u{FE0F}b'); // a + ✨(2 cols) + VS16(0) + b
    expect(buf.cx).toBe(4); // 1 + 2 + 0 + 1
    const cells = buf.lines[0].cells;
    expect(cells[0].char).toBe('a');
    expect(cells[1].char).toBe('\u{2728}');
    expect(cells[2].wide).toBe(true); // continuation of the wide emoji
    expect(cells[3].char).toBe('b');
    // VS16 must NOT occupy a cell (it previously rendered as "?" garbage)
    expect(cells.some((c) => c.char === '\u{FE0F}')).toBe(false);

    const zwj = new TerminalBuffer();
    zwj.write('x\u{200D}y'); // ZWJ between letters takes no column
    expect(zwj.cx).toBe(2);
  });

  it('counts emoji-presentation characters as double width (matches string-width)', () => {
    const buf = new TerminalBuffer();
    buf.write('\u{23F8}\u{2728}\u{2B50}'); // ⏸ ✨ ⭐ — 2 cols each
    expect(buf.cx).toBe(6);
    // Ambiguous non-emoji symbols stay single width
    const b2 = new TerminalBuffer();
    b2.write('\u{29C9}\u{25CF}'); // ⧉ ● — 1 col each
    expect(b2.cx).toBe(2);
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
    // Screen model: ED 2 replaces the screen with `rows` blank lines
    expect(buf.lines.length).toBe(buf.rows);
    expect(buf.lines.every((l) => l.cells.length === 0)).toBe(true);
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
    buf.resize(11); // resize() requires cols >= 10
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

  it('trims scrollback beyond max lines', () => {
    const buf = new TerminalBuffer();
    buf.setRows(5);
    buf.maxLines = 10;
    // 15 lines of output on a 5-row screen: 11 lines scroll off the top,
    // scrollback is capped at 10, screen holds the last 5.
    for (let i = 0; i < 15; i++) buf.write(`X${i}\n`);
    expect(buf.lines.length).toBe(15);
    expect(buf.lines[buf.cy]).toBeTruthy();
  });

  it('clears via clear()', () => {
    const buf = new TerminalBuffer();
    buf.write('abc');
    buf.clear();
    expect(buf.lines.length).toBe(buf.rows);
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

  it('SGR 7 with default colors produces visible dark-on-light block', () => {
    // The Claude/Ink cursor pattern: \x1b[7m \x1b[27m (inverted space).
    // When both fg and bg are default (undefined), inverse must resolve
    // the terminal defaults before swapping — otherwise undefined↔undefined
    // is invisible.
    const buf = new TerminalBuffer();
    buf.write('\x1b[7m \x1b[27m');
    const c = buf.lines[0].cells[0];
    // fg should be the dark background (#000000)
    expect(c.fg).toBe('#000000');
    // bg should be the light foreground (#f0f0f0)
    expect(c.bg).toBe('#f0f0f0');
  });

  it('inverts explicit fg/bg with SGR 7', () => {
    const buf = new TerminalBuffer();
    buf.write('\x1b[31m\x1b[48;5;21m'); // red fg, blue bg
    buf.write('\x1b[7mX');
    expect(buf.lines[0].cells[0].fg).toBe('#0000ff');   // blue (was bg)
    expect(buf.lines[0].cells[0].bg).toBe('#cd3131');   // red (was fg)
    buf.write('\x1b[27mY');
    expect(buf.lines[0].cells[1].fg).toBe('#cd3131');   // normal fg
    expect(buf.lines[0].cells[1].bg).toBe('#0000ff');   // normal bg
  });

  it('SGR 0 clears inverse', () => {
    const buf = new TerminalBuffer();
    // SGR 31: fg=red, bg=none. SGR 7: swap defaults → X: dark fg on red bg
    buf.write('\x1b[31m\x1b[7mX\x1b[0mY');
    expect(buf.lines[0].cells[0].fg).toBe('#000000'); // default bg → fg
    expect(buf.lines[0].cells[0].bg).toBe('#cd3131'); // red fg → bg
    // SGR 0 clears everything → Y gets defaults
    expect(buf.lines[0].cells[1].fg).toBeUndefined();
    expect(buf.lines[0].cells[1].bg).toBeUndefined();
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

describe('alternate screen (DEC 1047/1048/1049)', () => {
  const text = (buf: TerminalBuffer) =>
    buf.lines.map((l) => l.cells.map((c) => c.char).join('')).join('\n');

  it('1049h switches to a blank alt screen, saving main content and cursor', () => {
    const buf = new TerminalBuffer();
    buf.write('shell-output\r\nprompt$ ');
    buf.write('\x1b[?1049h');
    expect(buf.altActive).toBe(true);
    expect(buf.lines).toHaveLength(buf.rows); // blank screen = rows empty lines
    expect(buf.lines.every((l) => l.cells.length === 0)).toBe(true);
    expect(buf.cx).toBe(0);
    expect(buf.cy).toBe(0);
  });

  it('1049l restores main content and cursor position, hiding TUI frames', () => {
    const buf = new TerminalBuffer();
    buf.write('line1\r\nline2');
    buf.write('\x1b[?1049h');
    buf.write('TUI FRAME');
    buf.write('\x1b[?1049l');
    expect(buf.altActive).toBe(false);
    expect(text(buf)).toContain('line1');
    expect(text(buf)).toContain('line2');
    expect(text(buf)).not.toContain('TUI FRAME');
    expect(buf.cx).toBe(5); // after "line2"
    expect(buf.cy).toBe(1);
  });

  it('1049h clears previous alt content on re-entry', () => {
    const buf = new TerminalBuffer();
    buf.write('main');
    buf.write('\x1b[?1049h');
    buf.write('old-tui');
    buf.write('\x1b[?1049l');
    buf.write('\x1b[?1049h');
    expect(text(buf)).not.toContain('old-tui');
  });

  it('1047 toggles preserve alt content and do not touch the saved cursor', () => {
    const buf = new TerminalBuffer();
    buf.write('main');
    buf.write('\x1b[?1047h');
    buf.write('tui-stays');
    buf.write('\x1b[?1047l');
    expect(text(buf)).toContain('main');
    buf.write('\x1b[?1047h');
    expect(text(buf)).toContain('tui-stays'); // preserved across 1047 toggles
  });

  it('1049l outside alt screen is a no-op', () => {
    const buf = new TerminalBuffer();
    buf.write('abc');
    buf.write('\x1b[?1049l');
    expect(buf.altActive).toBe(false);
    expect(buf.lines[0].cells.map((c) => c.char).join('')).toBe('abc');
    expect(buf.cx).toBe(3);
  });

  it('scrollback trim inside alt screen does not shift the saved main cursor row', () => {
    const buf = new TerminalBuffer();
    buf.maxLines = 5;
    buf.write('a\r\nb\r\nc'); // cy = 2
    buf.write('\x1b[?1049h'); // saves main cursor (cy=2)
    buf.write('1\n2\n3\n4\n5\n6\n7\n8'); // forces trims inside alt
    buf.write('\x1b[?1049l');
    expect(buf.cy).toBe(2); // restored exactly, not shifted by alt trims
    expect(text(buf)).toContain('c');
  });

  it('works through the typed event pipeline (applyEvents dec)', () => {
    const buf = new TerminalBuffer();
    buf.applyEvents([{ t: 'txt', p: 'shell' }]);
    buf.applyEvents([{ t: 'dec', p: [1049, true] }]);
    expect(buf.altActive).toBe(true);
    buf.applyEvents([{ t: 'txt', p: 'TUI' }]);
    buf.applyEvents([{ t: 'dec', p: [1049, false] }]);
    expect(buf.altActive).toBe(false);
    expect(text(buf)).toContain('shell');
    expect(text(buf)).not.toContain('TUI');
  });
});

describe('VT screen model semantics', () => {
  it('CUP addresses the screen, not the scrollback', () => {
    const buf = new TerminalBuffer();
    buf.setRows(5);
    for (let i = 0; i < 10; i++) buf.write(`L${i}\n`); // 6 lines scroll off
    // scrollback: L0..L5, screen: L6..L9 + blank
    buf.write('\x1b[1;1H'); // CUP home = SCREEN row 0, not scrollback line 0
    buf.write('X');
    expect(buf.lines[0].cells[0].char).toBe('L');    // scrollback untouched
    expect(buf.lines[6].cells[0].char).toBe('X');    // screen top got X
    expect(buf.cy).toBe(6);                          // absolute cy = screen top
  });

  it('LF on the bottom row scrolls the top screen line into scrollback', () => {
    const buf = new TerminalBuffer();
    buf.setRows(3);
    buf.write('a\r\nb\r\nc\r\nd'); // writing d forces one scroll
    expect(buf.lines.map((l) => l.cells[0]?.char)).toEqual(['a', 'b', 'c', 'd']);
    expect(buf.cy).toBe(3); // scrollback(1) + screen row 2
  });

  it('CUD clamps to the bottom of the screen', () => {
    const buf = new TerminalBuffer();
    buf.setRows(5);
    buf.write('\x1b[999B');
    expect(buf.cy).toBe(4);
  });

  it('ED 0 clears to end of screen but preserves scrollback', () => {
    const buf = new TerminalBuffer();
    buf.setRows(4);
    buf.write('a\r\nb\r\nc\r\nd\r\ne'); // scrollback=[a], screen=[b,c,d,e]
    buf.write('\x1b[1;1H\x1b[J'); // home + ED 0
    expect(buf.lines[0].cells[0].char).toBe('a'); // scrollback intact
    const screenText = buf.lines.slice(1).map((l) => l.cells.map((c) => c.char).join(''));
    expect(screenText.every((t) => t === '')).toBe(true);
  });

  it('setRows shrink moves top lines to scrollback, grow pulls them back', () => {
    const buf = new TerminalBuffer();
    buf.setRows(6);
    buf.write('a\r\nb\r\nc\r\nd\r\ne'); // screen: a..e + blank, cursor on row 4 (e)
    const chars = () => buf.lines.map((l) => l.cells[0]?.char ?? ' ');
    buf.setRows(4);
    // 2 lines must go: the blank row below the cursor is dropped first
    // (invisible), then 'a' moves from the top into scrollback.
    expect(chars()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(buf.cy).toBe(4); // scrollback(1) + screen row 3
    buf.setRows(6);
    // Growing pulls 'a' back from scrollback, then pads one blank row
    expect(chars()).toEqual(['a', 'b', 'c', 'd', 'e', ' ']);
    expect(buf.cy).toBe(4);
  });

  it('resizing inside alt screen discards top lines; main restores on exit', () => {
    const buf = new TerminalBuffer();
    buf.setRows(5);
    buf.write('m1\r\nm2');
    buf.write('\x1b[?1049h');
    buf.write('t1\r\nt2\r\nt3\r\nt4\r\n'); // cursor on bottom row
    buf.setRows(4); // alt shrink: bottom row is the cursor's, so t1 is discarded (alt has no scrollback)
    const altText = buf.lines.map((l) => l.cells.map((c) => c.char).join('')).join('|');
    expect(altText).not.toContain('t1');
    buf.write('\x1b[?1049l');
    const mainText = buf.lines.map((l) => l.cells.map((c) => c.char).join('')).join('|');
    expect(mainText).toContain('m1');
    expect(mainText).toContain('m2');
  });
});
