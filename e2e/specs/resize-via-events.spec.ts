/**
 * Repro test: feeds REAL Claude PTY output through the TerminalBuffer
 * using applyEvents() (the actual production pipeline), then resizes.
 *
 * Without this, the previous test used buf.write() which bypasses the
 * Rust parser → structured events → applyEvents pipeline.
 */
import * as pty from 'node-pty';
import { TerminalBuffer } from '../../src/renderer/features/terminal/engine/buffer';

// Minimal re-implementation of the Rust parser's output format
interface TerminalEvent {
  t: string; p?: unknown;
}

const CHAR_W = 8.4;
const LINE_H = 16;

function renderLine(buf: TerminalBuffer, idx: number): string {
  return buf.lines[idx]?.cells.map(c => c.char).join('') ?? '';
}

/** Crude JS-side parser mirroring the Rust TerminalParser. */
function parseToEvents(data: string): TerminalEvent[] {
  const events: TerminalEvent[] = [];
  let i = 0;
  while (i < data.length) {
    const c = data.charCodeAt(i);

    if (c >= 0x20 && c !== 0x1b) {
      // Accumulate printable run
      let start = i;
      while (i < data.length && data.charCodeAt(i) >= 0x20 && data.charCodeAt(i) !== 0x1b) i++;
      events.push({ t: 'txt', p: data.slice(start, i) });
      continue;
    }

    if (c === 0x0d) { events.push({ t: 'cr' }); i++; continue; }
    if (c === 0x0a) { events.push({ t: 'lf' }); i++; continue; }
    if (c === 0x08) { events.push({ t: 'bs' }); i++; continue; }
    if (c === 0x09) { events.push({ t: 'tab' }); i++; continue; }

    if (c === 0x1b && i + 1 < data.length) {
      i++;
      if (data[i] === '[') {
        i++;
        let params = '';
        while (i < data.length) {
          const fc = data.charCodeAt(i);
          if (fc >= 0x40 && fc <= 0x7e) {
            const isPrivate = params.startsWith('?');
            const clean = isPrivate ? params.slice(1) : params;
            const nums = clean ? clean.split(';').map(Number) : [];
            if (isPrivate) {
              const final = String.fromCharCode(fc);
              events.push({ t: 'dec', p: [nums[0] || 0, final === 'h'] });
            } else {
              switch (fc) {
                case 0x6d: events.push({ t: 'm', p: nums }); break;   // SGR
                case 0x48: events.push({ t: 'H', p: [nums[0]||1, nums[1]||1] }); break;
                case 0x41: events.push({ t: 'A', p: nums[0] || 1 }); break;
                case 0x42: events.push({ t: 'B', p: nums[0] || 1 }); break;
                case 0x43: events.push({ t: 'C', p: nums[0] || 1 }); break;
                case 0x44: events.push({ t: 'D', p: nums[0] || 1 }); break;
                case 0x47: events.push({ t: 'G', p: nums[0] || 1 }); break;
                case 0x4a: events.push({ t: 'J', p: nums[0] || 0 }); break;
                case 0x4b: events.push({ t: 'K', p: nums[0] || 0 }); break;
                case 0x73: events.push({ t: 's' }); break;
                case 0x75: events.push({ t: 'u' }); break;
              }
            }
            i++; break;
          }
          params += data[i]; i++;
        }
        continue;
      }
      if (data[i] === ']') {
        // OSC — skip to terminator
        i++;
        while (i < data.length && data.charCodeAt(i) !== 0x07 && data[i] !== '\x1b') i++;
        if (i < data.length) {
          if (data.charCodeAt(i) === 0x07) i++;
          else if (data[i] === '\x1b' && i + 1 < data.length && data[i + 1] === '\\') i += 2;
        }
        continue;
      }
      i++; // simple ESC
      continue;
    }
    i++;
  }
  return events;
}

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
  console.log('PASS:', msg);
}

/**
 * True scatter corruption = visible chars split into ≥2 groups by wide
 * gaps (≥5 spaces) with at least one single-char group ("h    e    l").
 * Box-drawing frames and padded box content ("│      k3      │") are
 * legitimate output, NOT corruption — border chars are blanked first.
 */
function isScattered(l: string): boolean {
  if (l.length <= 30) return false;
  const cleaned = l.replace(/[\u2500-\u257F]/g, ' ');
  const groups = cleaned.split(/ {5,}/).map(g => g.trim()).filter(Boolean);
  return groups.length >= 2 && groups.some(g => g.length === 1);
}

async function main() {
  // Spawn Claude at 80 cols
  const proc = pty.spawn('claude', [], {
    name: 'xterm-256color', cols: 80, rows: 30,
    cwd: process.env.HOME || '/',
    env: process.env as Record<string, string>,
  });

  const buf = new TerminalBuffer();
  proc.onData((raw: string) => {
    // This is what the REAL production pipeline does:
    // Rust parser → events → buf.applyEvents(events)
    const events = parseToEvents(raw);
    buf.applyEvents(events);
  });

  await new Promise(r => setTimeout(r, 6000));

  // Check 80-col output
  const lines80 = buf.lines.map(l => l.cells.map(c => c.char).join(''));
  const scattered80 = lines80.filter(isScattered);
  assert(scattered80.length === 0, 'no scattered lines at 80 cols via applyEvents');

  // Resize to 120
  proc.resize(120, 30);
  buf.resize(120);
  await new Promise(r => setTimeout(r, 3000));

  const lines120 = buf.lines.map(l => l.cells.map(c => c.char).join(''));
  const scattered120 = lines120.filter(isScattered);
  assert(scattered120.length === 0, 'no scattered lines at 120 cols via applyEvents');

  // Resize to 60
  proc.resize(60, 30);
  buf.resize(60);
  proc.write('exit\r');
  await new Promise(r => setTimeout(r, 3000));

  const lines60 = buf.lines.map(l => l.cells.map(c => c.char).join(''));
  const scattered60 = lines60.filter(isScattered);
  assert(scattered60.length === 0, 'no scattered lines at 60 cols via applyEvents');

  proc.kill();
  console.log('\nAll checks passed via applyEvents pipeline.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
