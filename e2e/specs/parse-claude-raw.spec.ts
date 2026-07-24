/**
 * Feeds REAL Claude PTY output bytes through TerminalBuffer.write()
 * and checks for scattered-character corruption at each stage.
 *
 * Previous tests used a JS-side parser reimplementation that didn't
 * match the Rust parser — this test uses the ACTUAL production
 * write() method to eliminate that variable.
 */
import * as fs from 'node:fs';
import { TerminalBuffer } from '../../src/renderer/features/terminal/engine/buffer';

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
  console.log('PASS:', msg);
}

// Read raw Claude output
const raw = fs.readFileSync('/tmp/claude-raw.bin', 'utf-8');
console.log(`Raw data: ${raw.length} bytes`);

// Parse with the production write() method (NOT a JS reimplementation)
const buf = new TerminalBuffer();
buf.resize(80);

// Feed in 4KB chunks to exercise split-sequence handling
for (let i = 0; i < raw.length; i += 4096) {
  buf.write(raw.slice(i, i + 4096));
}

const lines = buf.lines.map(l => l.cells.map(c => c.char).join(''));

// ── Check 1: Claude UI text is present ──
const allText = lines.join('\n');
assert(allText.includes('Claude'), 'output contains Claude branding');
assert(allText.includes('Welcome'), 'output contains Welcome');

// ── Check 2: No scattered lines at 80 cols ──
// A scattered line has 1-4 non-space chars but is 50+ chars wide
const scattered = lines.filter(l => {
  const nonSpace = l.replace(/\s/g, '').length;
  return nonSpace > 0 && nonSpace < 5 && l.length > 40;
});

if (scattered.length > 0) {
  console.error(`\nFound ${scattered.length} scattered lines:`);
  scattered.slice(0, 10).forEach((l, i) => {
    console.error(`  [${i}] len=${l.length} chars="${l.slice(0, 60)}"`);
  });
}
assert(scattered.length === 0, `no scattered lines (found ${scattered.length})`);

// ── Check 3: No line exceeds 90 chars at 80 cols ──
const overlong = lines.filter(l => l.length > 90);
if (overlong.length > 0) {
  console.error(`\nFound ${overlong.length} overlong lines (>90 chars):`);
  overlong.slice(0, 5).forEach((l, i) => {
    console.error(`  [${i}] len=${l.length}`);
  });
}
assert(overlong.length === 0, `no overlong lines (found ${overlong.length})`);

// ── Check 4: Box borders align ──
// Claude TUI uses ╭ ╮ ╰ ╯ for box corners
const hasCorners = lines.some(l => l.includes('╭') || l.includes('╮'));
assert(hasCorners, 'TUI box corners present');

console.log(`\nTotal lines: ${lines.length}`);
console.log('All checks passed with production write() method.');
process.exit(0);
