import { test, expect } from '@playwright/test';
import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { setupTauriMock, emitPtyOutput, expectAnyTermContains } from './tauri-mock';

let batchDirectory: string;
test.beforeAll(async () => {
  if (process.platform === 'win32') return;
  batchDirectory = await mkdtemp(resolve(tmpdir(), 'vrykell-output-batch-'));
  execFileSync('rustc', ['--edition=2021', resolve('e2e/terminal-output-batch.rs'), '-o', resolve(batchDirectory, 'output-batch')]);
});
test.afterAll(async () => { if (batchDirectory) await rm(batchDirectory, { recursive: true, force: true }); });

for (const integration of [false, true]) {
test(`real vi receives normal-mode, insertion and Escape commands from ${integration ? 'block' : 'classic'} mode`, async ({ page }) => {
  test.skip(process.platform === 'win32', 'Requires a POSIX editor and PTY');
  const directory = await mkdtemp(resolve(tmpdir(), 'vrykell-vi-'));
  const file = resolve(directory, 'edit.txt');
  let child: ChildProcessWithoutNullStreams | undefined;
  let batch: ChildProcessWithoutNullStreams | undefined;
  let output = Promise.resolve();
  const editorInput: string[] = [];
  let editorOutput = '';
  try {
    await writeFile(file, 'alpha\nbeta\n');
    await setupTauriMock(page, { integration });
    await page.goto('/');
    await expect(page.locator('.terminal-pane:visible .xterm-helper-textarea').first()).toBeAttached();
    await page.waitForFunction(() => (window as unknown as { __PTY_SPAWNS__: unknown[] }).__PTY_SPAWNS__.length > 0);
    await page.exposeFunction('writeEditorInput', (data: string) => {
      editorInput.push(data);
      batch?.stdin.write('input\n');
      child?.stdin.write(JSON.stringify({ data }) + '\n');
    });
    await page.exposeFunction('resizeEditor', (cols: number, rows: number) => {
      child?.stdin.write(JSON.stringify({ resize: { cols, rows } }) + '\n');
    });
    await page.evaluate(() => {
      const target = window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args: Record<string, unknown>) => Promise<unknown> }; writeEditorInput: (data: string) => Promise<void>; resizeEditor: (cols: number, rows: number) => Promise<void> };
      const original = target.__TAURI_INTERNALS__.invoke;
      target.__TAURI_INTERNALS__.invoke = (cmd, args) => cmd === 'pty_write'
        ? target.writeEditorInput(args.data as string) : cmd === 'pty_resize'
          ? target.resizeEditor(args.cols as number, args.rows as number) : original(cmd, args);
      const registry = (window as unknown as { __vrykellTerms: Map<string, import('@xterm/xterm').Terminal>; __VI_CORNER_FRAMES__: string[] });
      registry.__VI_CORNER_FRAMES__ = [];
      const terminal = [...registry.__vrykellTerms.values()][0];
      terminal.onWriteParsed(() => {
        if (terminal.buffer.active.type !== 'alternate') return;
        const line = terminal.buffer.active.getLine(terminal.rows - 1)?.translateToString(false) ?? '';
        registry.__VI_CORNER_FRAMES__.push(line.slice(-24));
      });
    });
    if (integration) {
      const composer = page.locator('.terminal-pane:visible .terminal-composer textarea');
      await composer.fill('vi');
      await composer.press('Enter');
      await emitPtyOutput(page, '\x1b]133;C\x07');
    }
    const dimensions = await page.evaluate(() => {
      const term = [...(window as unknown as { __vrykellTerms: Map<string, import('@xterm/xterm').Terminal> }).__vrykellTerms.values()][0];
      return { cols: term.cols, rows: term.rows };
    });
    batch = spawn(resolve(batchDirectory, 'output-batch'));
    child = spawn('python3', ['-u', resolve('e2e/real-vi-pty.py'), file, String(dimensions.cols), String(dimensions.rows)]);
    let buffered = '';
    child.stdout.on('data', (chunk: Buffer) => {
      buffered += chunk.toString();
      let end: number;
      while ((end = buffered.indexOf('\n')) >= 0) {
        const encoded = buffered.slice(0, end);
        editorOutput += Buffer.from(encoded, 'base64').toString('utf8');
        buffered = buffered.slice(end + 1);
        batch!.stdin.write(encoded + '\n');
      }
    });
    let batched = '';
    batch.stdout.on('data', (chunk: Buffer) => {
      batched += chunk.toString();
      let end: number;
      while ((end = batched.indexOf('\n')) >= 0) {
        const parts = JSON.parse(batched.slice(0, end)) as string[];
        batched = batched.slice(end + 1);
        const data = parts.map(part => Buffer.from(part, 'base64').toString('utf8')).join('');
        output = output.then(() => emitPtyOutput(page, data));
      }
    });
    await expectAnyTermContains(page, 'alpha');
    await page.locator('.terminal-pane:visible .xterm-helper-textarea').first().focus();
    await page.evaluate(async () => {
      const path = '/src/features/terminal/stores/terminal.ts';
      const { useTerminalStore } = await import(path) as typeof import('../src/features/terminal/stores/terminal');
      useTerminalStore.getState().setKeyboardTarget('terminal');
    });
    if (integration) {
      const hidden = page.getByTestId('running-term').locator('textarea');
      await expect(hidden).toBeAttached();
      await hidden.evaluate(element => (element as HTMLTextAreaElement).focus());
      await expect(page.locator('.terminal-pane:visible .xterm-helper-textarea').first()).toBeFocused();
    }
    await page.keyboard.press('j');
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowRight', 'ArrowLeft']) {
      await page.keyboard.press(key);
    }
    await page.keyboard.press('d');
    await page.keyboard.press('Escape');
    // Exercise the composed native commit path that may omit keypress in a webview.
    await page.locator('.terminal-pane:visible .xterm-helper-textarea').first().evaluate(element => {
      element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Unidentified', keyCode: 229 }));
      (element as HTMLTextAreaElement).value += 'i';
      element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: 'i' }));
    });
    await expect.poll(() => editorInput.includes('i')).toBe(true);
    await page.keyboard.type('delta');
    await page.keyboard.press('Escape');
    await page.keyboard.type(':wq');
    await page.keyboard.press('Enter');
    await expect.poll(() => readFile(file, 'utf8')).toBe('alpha\ndeltabeta\n');
    const cornerFrames = await page.evaluate(() => (window as unknown as { __VI_CORNER_FRAMES__: string[] }).__VI_CORNER_FRAMES__);
    expect(cornerFrames.length).toBeGreaterThan(0);
    expect(editorOutput).toContain('~@k');
    expect(cornerFrames.filter(frame => /~@k|[;\[\]]/.test(frame))).toEqual([]);
    // Compare protocol replies to actual requests, including probes before alternate entry.
    const versionRequests = editorOutput.match(/\x1b\[>c/g)?.length ?? 0;
    expect(versionRequests).toBeGreaterThan(0);
    expect(editorInput.filter(data => data === '\x1b[>0;276;0c')).toHaveLength(versionRequests);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'close');
      child.kill();
      await closed;
    }
    if (batch && batch.exitCode === null && batch.signalCode === null) {
      const closed = once(batch, 'close');
      batch.kill();
      await closed;
    }
    await output.catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});

}
