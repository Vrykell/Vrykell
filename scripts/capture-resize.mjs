// Capture Claude TUI output during shrink+expand resize cycle.
import { spawn } from 'node-pty';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const OUT = resolve(process.argv[2] || '/tmp/claude-resize-raw.bin');
const META = OUT.replace(/\.bin$/, '.json');

console.error(`Capturing to ${OUT}...`);

const pty = spawn('claude', [], {
  name: 'xterm-256color',
  cols: 100,
  rows: 30,
  cwd: process.env.HOME || '/tmp',
  env: { ...process.env, TERM: 'xterm-256color', COLUMNS: '100', LINES: '30' },
});

let output = '';
let phases = [];

function maybeSave(tag) {
  phases.push({ tag, byteLen: output.length, time: Date.now() });
  console.error(`  [${tag}] captured ${output.length} bytes at ${new Date().toISOString()}`);
}

function save() {
  writeFileSync(OUT, output);
  writeFileSync(META, JSON.stringify({ phases, totalBytes: output.length }, null, 2));
  console.error(`Saved ${output.length} bytes to ${OUT}`);
}

let phase = 0;
let lastDataTime = Date.now();

pty.onData((data) => {
  output += data;
  lastDataTime = Date.now();

  if (phase === 0 && output.length > 10000) {
    phase = 1;
    maybeSave('initial');
    console.error('Phase 1: shrinking to 40 cols...');
    pty.resize(40, 30);
  }

  if (phase === 1 && output.length > 20000) {
    phase = 2;
    maybeSave('after_shrink');
    console.error('Phase 2: expanding to 100 cols...');
    pty.resize(100, 30);
  }
});

const poll = setInterval(() => {
  if (phase >= 2 && Date.now() - lastDataTime > 3000) {
    maybeSave('final');
    clearInterval(poll);
    save();
    pty.kill();
    process.exit(0);
  }
}, 500);

setTimeout(() => {
  maybeSave('timeout');
  clearInterval(poll);
  save();
  pty.kill();
  process.exit(1);
}, 20000);
