/**
 * Integration test: spawn real Claude via node-pty, capture output,
 * resize the PTY mid-session, and verify no text corruption.
 *
 * Run with: npx tsx e2e/specs/resize-claude.spec.ts
 */
import * as pty from 'node-pty';
import { TerminalBuffer } from '../../src/renderer/features/terminal/engine/buffer';

const CHAR_W = 8.4; // approximate
const LINE_H = 16;

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
  console.log('PASS:', msg);
}

function renderLine(buf: TerminalBuffer, idx: number): string {
  return buf.lines[idx]?.cells.map(c => c.char).join('') ?? '';
}

async function main() {
  // Spawn Claude at 80 cols
  const proc = pty.spawn('claude', [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 30,
    cwd: process.env.HOME || '/',
    env: process.env as Record<string, string>,
  });

  const buf = new TerminalBuffer();
  let raw = '';

  proc.onData((data: string) => {
    raw += data;
    buf.write(data);
  });

  // Wait for Claude to render its initial UI
  await new Promise(r => setTimeout(r, 6000));

  // ── Check 1: initial output at 80 cols is not garbled ────────────────
  const beforeLines = buf.lines.map(l => l.cells.map(c => c.char).join(''));
  const beforeText = beforeLines.join('\n');

  // The TUI border "╭" or "─" should appear near column 0
  assert(
    beforeText.includes('╭') || beforeText.includes('Claude'),
    'initial output contains Claude UI at 80 cols',
  );

  // No line should be wildly longer than 80 cols (allow some overflow for box-drawing)
  const overlongLines = beforeLines.filter(l => l.length > 90);
  assert(
    overlongLines.length === 0,
    `no lines exceed 90 chars at 80 cols (found ${overlongLines.length}: lengths ${overlongLines.map(l => l.length)})`,
  );

  // ── Resize to 120 cols ──────────────────────────────────────────────
  proc.resize(120, 30);
  buf.resize(120);

  // Give Claude time to receive SIGWINCH and re-render
  await new Promise(r => setTimeout(r, 2000));

  // Type something to trigger Claude to respond with re-rendered output
  proc.write('hello\r');
  await new Promise(r => setTimeout(r, 3000));

  // ── Check 2: output after resize is not garbled ─────────────────────
  const afterLines = buf.lines.map(l => l.cells.map(c => c.char).join(''));
  const afterText = afterLines.join('\n');

  // Claude's TUI border should now extend to ~120 cols (visible as longer lines)
  const longerLines = afterLines.filter(l => l.length > 90 && l.length <= 130);
  assert(
    longerLines.length > 0,
    `after resize to 120 cols, some lines should be >90 chars (found ${longerLines.length})`,
  );

  // No line should have scattered single characters (indicative of cx misalignment)
  // Pattern: a line with isolated chars separated by many spaces = corruption
  const scatteredLines = afterLines.filter(l => {
    const chars = l.replace(/\s/g, '');
    const spaces = l.replace(/\S/g, '');
    // If there are only 1-3 chars but 50+ spaces, it's scattered corruption
    return chars.length > 0 && chars.length < 5 && spaces.length > 30;
  });
  assert(
    scatteredLines.length === 0,
    `no scattered-character lines after resize (found ${scatteredLines.length})`,
  );

  // ── Resize back to 60 cols ──────────────────────────────────────────
  const lineCountBeforeNarrow = buf.lines.length;
  proc.resize(60, 30);
  buf.resize(60);

  proc.write('exit\r');
  await new Promise(r => setTimeout(r, 3000));

  // ── Check 3: NEW lines after narrowing fit within 60 cols ───────────
  // Old lines (written at 120 cols) will be wider — that's correct,
  // terminals don't reflow existing content.
  const allLines = buf.lines.map(l => l.cells.map(c => c.char).join(''));
  const newLines = allLines.slice(lineCountBeforeNarrow);

  const newOverlong = newLines.filter(l => l.length > 70);
  assert(
    newOverlong.length === 0,
    `new lines after narrowing fit in 60 cols (found ${newOverlong.length} overlong)`,
  );

  // No scattered corruption in new lines
  const newScattered = newLines.filter(l => {
    const chars = l.replace(/\s/g, '').length;
    return chars > 0 && chars < 5 && l.length > 40;
  });
  assert(newScattered.length === 0, 'no scattered lines in new output after narrowing');

  proc.kill();
  console.log('\nAll checks passed.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
