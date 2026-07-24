/**
 * Scratch reproduction: simulate real shell + TUI sequences against the
 * new screen-model buffer and print snapshots to find desync.
 * Run: npx vitest run src/renderer/terminal/repro.test.ts
 */
import { describe, it } from 'vitest';
import { TerminalBuffer } from '../buffer';

function snap(buf: TerminalBuffer, label: string) {
  const lines = buf.lines.map(
    (l, i) => `${i === buf.cy ? '>' : ' '}${String(i).padStart(3)}|${l.cells.map((c) => c.char).join('')}`,
  );
  console.log(`\n=== ${label} (cy=${buf.cy}, cx=${buf.cx}, cols=${buf.cols}, rows=${buf.rows}, total=${buf.lines.length}) ===`);
  console.log(lines.join('\n'));
}

describe('reproduction', () => {
  it('shell streaming: 15 lines of output at rows=8', () => {
    const buf = new TerminalBuffer();
    buf.resize(40);
    buf.setRows(8);
    buf.write('$ ls\r\n');
    for (let i = 1; i <= 15; i++) buf.write(`file${i}.txt\r\n`);
    buf.write('$ ');
    snap(buf, 'shell stream');
  });

  it('zsh prompt redraw: CR + EL + rewrite same line', () => {
    const buf = new TerminalBuffer();
    buf.resize(40);
    buf.setRows(8);
    buf.write('$ git status\r\n');
    buf.write('On branch dev\r\n');
    buf.write('$ ');
    // zsh rewrites prompt: CR, clear line, draw right prompt then back
    buf.write('\r\x1b[K$ git st');
    snap(buf, 'zsh prompt');
  });

  it('TUI full-frame redraw: draw 8-line frame, then redraw via CUU + overwrite', () => {
    const buf = new TerminalBuffer();
    buf.resize(30);
    buf.setRows(8);
    buf.write('\x1b[?1049h'); // enter alt
    // frame 1: 6 lines
    for (let i = 0; i < 6; i++) buf.write(`frame1-line${i}\r\n`);
    snap(buf, 'after frame 1');
    // frame 2: TUI moves up 6 lines (to frame start), overwrites
    buf.write('\x1b[6A');
    for (let i = 0; i < 6; i++) buf.write(`\x1b[2K\rframe2-line${i}\r\n`);
    snap(buf, 'after frame 2 redraw');
  });

  it('TUI frame shorter than screen, resize smaller mid-session', () => {
    const buf = new TerminalBuffer();
    buf.resize(30);
    buf.setRows(10);
    buf.write('\x1b[?1049h');
    for (let i = 0; i < 6; i++) buf.write(`content${i}\r\n`);
    buf.setRows(5);
    snap(buf, 'alt shrunk to 5');
    buf.write('\x1b[?1049l');
    snap(buf, 'exited to main');
  });
});

describe('real Claude Code startup capture (100x30)', () => {
  it('replays without garbage: no leaked charset bytes, no underline explosion', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const data = readFileSync(
      resolve(__dirname, '../../../../../test/fixtures/terminal/claude-startup-100x30.log'),
      'utf-8',
    );
    const buf = new TerminalBuffer();
    buf.resize(100);
    buf.setRows(30);
    buf.write(data);

    const allCells = buf.lines.flatMap((l) => l.cells);

    // CSI > 4 m (modifyOtherKeys) must NOT have become SGR underline
    const underlined = allCells.filter((c) => c.underline);
    expect(underlined.length).toBe(0);

    // The welcome frame must be present and readable
    const text = buf.lines.map((l) => l.cells.map((c) => c.char).join('')).join('\n');
    expect(text).toContain('Claude Code');
    expect(text).toContain('Welcome back!');

    // No stray 'B' from ESC ( B charset leaks: a lone 'B' cell surrounded
    // by spaces is a leak signature (Claude's frame has no such pattern)
    const strayB = buf.lines.filter((l) => {
      const t = l.cells.map((c) => c.char).join('');
      return / {3}B {3}/.test(t) || /^B {5}/.test(t) || / {5}B$/.test(t);
    });
    expect(strayB.length).toBe(0);

    // Dump for eyeball inspection
    console.log('\n=== Claude startup replay ===');
    console.log(
      buf.lines
        .map((l, i) => `${i === buf.cy ? '>' : ' '}${String(i).padStart(2)}|${l.cells.map((c) => c.char).join('')}`)
        .join('\n'),
    );
  });
});
