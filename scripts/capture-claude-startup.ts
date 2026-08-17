/**
 * Capture raw terminal output of Claude Code startup at 100x30.
 * Saves the fixture to src/test/fixtures/terminal/claude-startup-100x30.log
 */
import * as pty from 'node-pty';
import * as fs from 'node:fs';
import * as path from 'node:path';

const COLS = 100;
const ROWS = 30;
const OUTPUT = path.resolve(
  __dirname,
  '..',
  'src',
  'test',
  'fixtures',
  'terminal',
  'claude-startup-100x30.log',
);

async function main() {
  const shell = 'C:/Program Files/Git/usr/bin/bash.exe';
  const shellArgs = ['-i'];

  const chunks: Buffer[] = [];

  const p = pty.spawn(shell, shellArgs, {
    name: 'xterm-256color',
    cols: COLS,
    rows: ROWS,
    cwd: process.cwd(),
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      HOME: process.env.HOME || process.env.USERPROFILE,
    },
  });

  p.onData((data: string) => {
    chunks.push(Buffer.from(data, 'utf-8'));
  });

  // Wait for bash to be ready, then launch claude
  setTimeout(() => {
    p.write('claude\n');
  }, 3000);

  // Wait long enough for the startup screen to render, then send exit
  setTimeout(() => {
    p.write('\x03'); // Ctrl+C
  }, 12000);

  // Give more time, then kill pty
  setTimeout(() => {
    p.kill();
    const all = Buffer.concat(chunks);
    fs.writeFileSync(OUTPUT, all);
    console.log(`Captured ${all.length} bytes to ${OUTPUT}`);
    process.exit(0);
  }, 18000);
}

main();
