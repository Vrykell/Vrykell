import { describe, it, expect, vi } from 'vitest';
import { SessionController, type SessionSinks } from '@features/terminal/services/pipeline/sessionController';
import { formatCommandSubmission } from '@features/terminal/model/commandSubmission';
import { blockTerminalFor } from '@features/terminal/services/terminalRepaint';
import { ScanHelper } from '@features/terminal/services/pipeline/__tests__/scanHelper';

function wire(tabId = 't1', deferBlockUntilPreexec = false, pendingUiCommand?: { command: string; wireCommand?: string }, deferFallbackMs = 3000) {
  const st = {
    written: '',
    blocksChanged: 0,
    scenes: [] as string[],
    cwds: [] as string[],
    started: [] as string[],
    completed: [] as string[],
    replies: [] as string[],
    programTitles: [] as string[],
  };
  let staged = pendingUiCommand;
  const sinks: SessionSinks = {
    writeMain: (d) => { st.written += d; },
    onBlocksChanged: () => { st.blocksChanged++; },
    onSceneChanged: (s) => { st.scenes.push(s); },
    onCwd: (p) => { st.cwds.push(p); },
    onBlockStart: (b) => { st.started.push(b.command); },
    onBlockComplete: (b) => { st.completed.push(b.command); },
    onTerminalData: data => { st.replies.push(data); },
    onProgramTitle: (title) => { st.programTitles.push(title); },
    takePendingUiCommand: pendingUiCommand ? () => {
      const pending = staged;
      staged = undefined;
      return pending ?? null;
    } : undefined,
    clearPendingUiCommand: () => { staged = undefined; },
  };
  const ctrl = new SessionController(tabId, 80, sinks, 24, 'classic', true, deferBlockUntilPreexec, deferFallbackMs);
  const scan = new ScanHelper();
  const feed = (chunk: string) => ctrl.handleEvents(scan.push(chunk));
  return { st, ctrl, feed };
}

const A = '\x1b]133;A\x07';
const C = '\x1b]133;C\x07';
const D = (ec: number) => `\x1b]133;D;${ec}\x07`;
const E = (cmd: string) => `\x1b]133;E;${btoa(cmd)}\x07`;
const OSC7 = (p: string) => `\x1b]7;file://host${p}\x07`;

// xterm writes queue asynchronously; finishBlock drains them with an empty write callback before taking the snapshot.
// Poll until the predicate holds (fixed delays are unreliable in a full parallel run).
async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('SessionController', () => {
  it('accepts an empty submission after restored history has no pending prompt', () => {
    const { ctrl, feed } = wire();
    feed(`${OSC7('/Users/test')}${A}`);
    ctrl.seed([]);
    ctrl.appendBlankLines(1);
    expect(ctrl.blocks[0]).toMatchObject({ command: '', cwd: '/Users/test', status: 'done', outputText: '' });
    expect(ctrl.activeBlock?.status).toBe('pending');
    ctrl.dispose();
  });

  it('preserves every empty submission as a completed block with directory context', () => {
    const { ctrl, feed, st } = wire();
    feed(`${OSC7('/Users/test/work')}${A}`);
    ctrl.appendBlankLines(3);
    const submitted = ctrl.blocks.filter(block => block.status === 'done');
    expect(submitted).toHaveLength(3);
    expect(new Set(submitted.map(block => block.id)).size).toBe(3);
    expect(submitted.every(block => block.cwd === '/Users/test/work' && block.command === '' && block.outputText === '' && block.startedAt !== null && block.outputHtml === '')).toBe(true);
    expect(st.completed).toHaveLength(3);
    expect(ctrl.activeBlock?.status).toBe('pending');
    feed(A + A + A);
    expect(ctrl.blocks.filter(block => block.outputText === '' && block.startedAt !== null)).toHaveLength(3);
    const restored = wire('restored');
    restored.ctrl.seed(submitted);
    expect(restored.ctrl.blocks.map(block => [block.cwd, block.outputText])).toEqual(submitted.map(block => [block.cwd, block.outputText]));
    restored.ctrl.dispose();
    ctrl.dispose();
  });
  it('does not add empty submissions to a running foreground program', () => {
    const { ctrl, feed } = wire();
    feed(`${A}${E('vi')}${C}`);
    ctrl.appendBlankLines(2);
    expect(ctrl.blocks).toHaveLength(1);
    ctrl.dispose();
  });

  it('answers startup queries before the running view mounts, without forwarding them twice', async () => {
    const { st, ctrl, feed } = wire();
    feed(`${A}${E('vi')}${C}\x1b[6n\x1b[>c`);
    await waitFor(() => st.replies.length === 2);
    expect(st.replies).toEqual(['\x1b[1;1R', '\x1b[>0;276;0c']);
    expect(ctrl.executingTerm?.term.element).toBeUndefined();
    feed('\x1b]11;?\x07');
    await waitFor(() => st.replies.length === 3);
    expect(st.replies[2]).toMatch(/^\x1b\]11;rgb:/);
    expect(st.written).not.toContain('\x1b[6n');
    ctrl.executingTerm!.term.input('j', true);
    expect(st.replies[st.replies.length - 1]).toBe('j');
    expect(st.replies).toHaveLength(4);
    ctrl.dispose();
  });
  it('keeps live output until the complete parsed snapshot replaces it', async () => {
    const { st, ctrl, feed } = wire();
    feed(`${A}${E('ls')}${C}Documents\r\n${D(0)}`);
    expect(ctrl.blocks[0]?.snapshotPending).toBe(true);
    expect(st.completed).toHaveLength(0);
    await waitFor(() => st.completed.length === 1);
    expect(ctrl.blocks[0]?.snapshotPending).toBe(false);
    expect(ctrl.blocks[0]?.outputText).toBe('Documents');
    ctrl.dispose();
  });

  it('registers the live block terminal for app-wide drawing operations', async () => {
    const { st, ctrl, feed } = wire('registry');
    feed(`${A}${E('ls')}${C}`);
    expect(blockTerminalFor('registry')).toBe(ctrl.executingTerm?.term);
    feed(`Documents\r\n${D(0)}`);
    await waitFor(() => st.completed.length === 1);
    // The surface is unregistered as soon as the completed snapshot replaces the live terminal.
    expect(blockTerminalFor('registry')).toBeNull();
    ctrl.dispose();
  });
  it('hands terminal-control OSC to the running block terminal instead of dropping it', () => {
    const { st, ctrl, feed } = wire();
    feed(A);
    ctrl.setPendingCommand('probe');
    expect(ctrl.activeBlock?.status).toBe('executing');

    // The block terminal is the running command's terminal, so a capability query has to
    // reach it for the reply to come back; it must not leak into the idle main xterm.
    const query = '\x1b]11;?\x07';
    feed(query);
    expect(ctrl.activeBlock?.outputRaw).toContain(query);
    expect(st.written).not.toContain(query);

    // Nothing is running once the block is done: the same OSC has no terminal to answer it.
    feed(`${D(0)}${A}`);
    feed(query);
    expect(st.written).not.toContain(query);
    expect(ctrl.activeBlock?.outputRaw).not.toContain(query);
    ctrl.dispose();
  });

  it('reflects the window title a running command sets and clears it when the command ends', () => {
    const { st, ctrl, feed } = wire();
    feed(A);
    // At the prompt the terminal belongs to the shell, so a title there is ignored.
    feed('\x1b]2;shell-cwd\x07');
    expect(st.programTitles).toEqual([]);
    feed(`${E('claude')}${C}`);
    feed('\x1b]2;⠋ Claude\x07');
    expect(st.programTitles).toEqual(['⠋ Claude']);
    // Re-sending the same title does not notify again (the spinner redraws often).
    feed('\x1b]2;⠋ Claude\x07');
    expect(st.programTitles).toEqual(['⠋ Claude']);
    feed('\x1b]2;⠙ Claude\x07');
    expect(st.programTitles).toEqual(['⠋ Claude', '⠙ Claude']);
    // An empty payload clears it.
    feed('\x1b]2;\x07');
    expect(st.programTitles).toEqual(['⠋ Claude', '⠙ Claude', '']);
    feed('\x1b]0;⠹ Claude\x07');
    expect(st.programTitles).toEqual(['⠋ Claude', '⠙ Claude', '', '⠹ Claude']);
    // Finishing the command returns to the generated title.
    feed(D(0));
    expect(st.programTitles).toEqual(['⠋ Claude', '⠙ Claude', '', '⠹ Claude', '']);
    ctrl.dispose();
  });

  it('keeps a full-screen program title until the alternate screen exits', () => {
    const { st, ctrl, feed } = wire();
    feed(`${A}${E('claude')}${C}\x1b[?1049h`);
    feed('\x1b]0;⠋ working\x07');
    expect(st.programTitles).toEqual(['⠋ working']);
    feed('\x1b[?1049l');
    expect(st.programTitles).toEqual(['⠋ working', '']);
    ctrl.dispose();
  });

  it('renders submitted SSH output even when the remote shell omits the preexec marker', async () => {
    const { st, ctrl, feed } = wire();
    feed(A);
    ctrl.setPendingCommand('ls');
    feed('ls\r\nDocuments\r\nnotes.txt\r\n');
    expect(ctrl.activeBlock?.status).toBe('executing');
    expect(ctrl.activeBlock?.outputRaw).toContain('notes.txt');
    feed(`${D(0)}${A}`);
    await waitFor(() => st.completed.length === 1);
    expect(ctrl.blocks[0]?.outputText).toBe('Documents\nnotes.txt');
    expect(ctrl.blocks[0]?.command).toBe('ls');
    ctrl.setPendingCommand('pwd');
    feed(`/home/test\r\n${D(0)}${A}`);
    await waitFor(() => st.completed.length === 2);
    expect(ctrl.blocks[1]?.outputText).toBe('/home/test');
    ctrl.dispose();
  });

  it('does not duplicate submitted blocks when delayed preexec markers arrive', async () => {
    const { st, ctrl, feed } = wire();
    feed(A);
    ctrl.setPendingCommand('ls');
    feed(`ls\r\n${E('ls')}${C}notes.txt\r\n${D(0)}${A}`);
    await waitFor(() => st.completed.length === 1);
    expect(st.started).toEqual(['ls']);
    expect(ctrl.blocks).toHaveLength(2);
    expect(ctrl.blocks[0]?.outputText).toBe('notes.txt');
    ctrl.dispose();
  });

  it('defers an integrated submission until the shell reports the command', async () => {
    const { st, ctrl, feed } = wire('deferred', true);
    const script = "Write-Output '中文'\nWrite-Output 'done'";
    const payload = formatCommandSubmission(script, 'powershell').trimEnd();
    feed(A);
    ctrl.setPendingCommand(script, payload);
    expect(ctrl.activeBlock?.status).toBe('pending');
    expect(ctrl.blocks).toHaveLength(1);
    feed(`${payload}\r\n${E(payload)}${C}中文\r\ndone\r\n${D(0)}`);
    await waitFor(() => st.completed.length === 1);
    expect(st.started).toEqual([script]);
    expect(ctrl.blocks[0]?.command).toBe(script);
    expect(ctrl.blocks[0]?.outputText).toBe('中文\ndone');
    expect(ctrl.blocks[0]?.outputText).not.toContain('Invoke-Expression');
    ctrl.dispose();
  });

  it('keeps the visible command when a late prompt arrives before preexec', async () => {
    const { st, ctrl, feed } = wire('late-prompt', true);
    const script = "Write-Output 'one'\nWrite-Output 'two'";
    const payload = formatCommandSubmission(script, 'powershell').trimEnd();
    feed(A);
    ctrl.setPendingCommand(script, payload);
    feed(`${payload}\r\n${A}${E(payload)}${C}one\r\ntwo\r\n${D(0)}`);
    await waitFor(() => st.completed.length === 1);
    expect(st.completed).toEqual([script]);
    const completed = ctrl.blocks.find(block => block.command === script);
    expect(completed?.outputText).toBe('one\ntwo');
    ctrl.dispose();
  });

  it('uses the staged wire when the controller starts after submission', async () => {
    const script = "Write-Output 'staged'\nWrite-Output 'wire'";
    const payload = formatCommandSubmission(script, 'powershell').trimEnd();
    const { st, ctrl, feed } = wire('staged', true, { command: script, wireCommand: payload });
    feed(`${E(payload)}${C}staged\r\nwire\r\n${D(0)}`);
    await waitFor(() => st.completed.length === 1);
    expect(st.completed).toEqual([script]);
    expect(ctrl.blocks[0]?.command).toBe(script);
    expect(ctrl.blocks[0]?.outputText).toBe('staged\nwire');
    ctrl.dispose();
  });

  it('does not carry a classic-scene submission into the first prompt', async () => {
    const { st, ctrl, feed } = wire('classic-stale', true);
    ctrl.setPendingCommand('stale', 'stale-wire');
    feed(A);
    feed(`${E('fresh')}${C}fresh\r\n${D(0)}`);
    await waitFor(() => st.completed.length === 1);
    expect(st.completed).toEqual(['fresh']);
    ctrl.dispose();
  });

  it('decodes a shell-reported transport without a UI submission', async () => {
    const { st, ctrl, feed } = wire('agent', true);
    const script = "Write-Output 'agent'\nWrite-Output 'done'";
    const payload = formatCommandSubmission(script, 'powershell').trimEnd();
    feed(`${A}${E(payload)}${C}agent\r\ndone\r\n${D(0)}`);
    await waitFor(() => st.completed.length === 1);
    expect(st.completed).toEqual([script]);
    expect(ctrl.blocks[0]?.command).toBe(script);
    expect(ctrl.blocks[0]?.outputText).toBe('agent\ndone');
    ctrl.dispose();
  });

  it('strips a repainted transport echo before output', async () => {
    const { st, ctrl, feed } = wire('repaint', true);
    const script = "Write-Output 'repaint'\nWrite-Output 'done'";
    const payload = formatCommandSubmission(script, 'powershell').trimEnd();
    feed(A);
    ctrl.setPendingCommand(script, payload);
    feed(`\x1b[12;2H${payload}\x1b[K\r\n${E(payload)}${C}repaint\r\ndone\r\n${D(0)}`);
    await waitFor(() => st.completed.length === 1);
    expect(ctrl.blocks[0]?.outputText).toBe('repaint\ndone');
    expect(ctrl.blocks[0]?.outputText).not.toContain('Invoke-Expression');
    ctrl.dispose();
  });

  it('shows output when integration never reports preexec', async () => {
    const { st, ctrl, feed } = wire('fallback', true, undefined, 10);
    const script = "Write-Output 'fallback'";
    const payload = formatCommandSubmission(script, 'powershell').trimEnd();
    feed(A);
    ctrl.setPendingCommand(script, payload);
    feed(`${payload}\r\nfallback\r\n`);
    await waitFor(() => ctrl.activeBlock?.status === 'executing');
    feed(`${D(0)}`);
    await waitFor(() => st.completed.length === 1);
    expect(st.completed).toEqual([script]);
    expect(ctrl.blocks[0]?.outputText).toBe('fallback');
    ctrl.dispose();
  });

  it('captures fast command output when completion arrives before the missing-preexec fallback', async () => {
    const { st, ctrl, feed } = wire('fast-fallback', true);
    feed(A);
    for (const command of ['ls', 'pwd']) {
      ctrl.setPendingCommand(command);
      feed(`${command}\r\nresult-${command}\r\n${D(0)}${A}`);
    }
    await waitFor(() => st.completed.length === 2);
    expect(ctrl.blocks.slice(0, 2).map(block => [block.command, block.outputText, block.exitCode]))
      .toEqual([['ls', 'result-ls', 0], ['pwd', 'result-pwd', 0]]);
    ctrl.dispose();
  });

  it('clears a pending submission and its fallback timer', async () => {
    const { ctrl, feed } = wire('cleared', true, undefined, 10);
    feed(A);
    ctrl.setPendingCommand('echo never', 'echo never');
    ctrl.clearPendingCommand();
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(ctrl.activeBlock?.status).toBe('pending');
    ctrl.dispose();
  });

  it('rejects a different submission while one is waiting for preexec', () => {
    const { ctrl, feed } = wire('busy-pending', true);
    feed(A);
    expect(ctrl.setPendingCommand('first', 'first-wire')).toBe(true);
    expect(ctrl.setPendingCommand('second', 'second-wire')).toBe(false);
    expect(ctrl.setPendingCommand('first', 'first-wire')).toBe(true);
    ctrl.dispose();
  });

  it('creates a deferred block when preexec arrives before the prompt', async () => {
    const { st, ctrl, feed } = wire('early-preexec', true);
    const script = "Write-Output 'early'";
    const payload = formatCommandSubmission(script, 'powershell').trimEnd();
    ctrl.setPendingCommand(script, payload);
    feed(`${E(payload)}${C}early\r\n${D(0)}`);
    await waitFor(() => st.completed.length === 1);
    expect(st.completed).toEqual([script]);
    expect(ctrl.blocks[0]?.outputText).toBe('early');
    ctrl.dispose();
  });

  it('strips the wire transport echo when the block is created eagerly', () => {
    const { ctrl, feed } = wire();
    const script = "Write-Output 'one'\nWrite-Output 'two'";
    const payload = formatCommandSubmission(script, 'powershell').trimEnd();
    feed(A);
    ctrl.setPendingCommand(script, payload);
    expect(ctrl.activeBlock?.status).toBe('executing');
    feed(`${payload}\r\n`);
    expect(ctrl.activeBlock?.outputRaw).not.toContain('Invoke-Expression');
    ctrl.dispose();
  });

  it('replaces a running block command with the decoded transport', () => {
    const { ctrl, feed } = wire();
    const script = "Write-Output 'x'\nWrite-Output 'y'";
    const payload = formatCommandSubmission(script, 'powershell').trimEnd();
    feed(`${A}${E('placeholder')}${C}`);
    feed(E(payload));
    expect(ctrl.activeBlock?.command).toBe(script);
    ctrl.dispose();
  });

  it('creates a boundary for an eager submission after a completed block', () => {
    const { ctrl, feed } = wire();
    feed(`${A}${E('first')}${C}one\r\n${D(0)}`);
    ctrl.setPendingCommand('second');
    expect(ctrl.activeBlock?.command).toBe('second');
    expect(ctrl.activeBlock?.status).toBe('executing');
    ctrl.dispose();
  });

  it('restores a prepared wire when an eager submission needs a boundary', () => {
    const { ctrl, feed } = wire();
    feed(`${A}${E('first')}${C}one\r\n${D(0)}`);
    ctrl.setPendingCommand('second', 'second-wire');
    expect(ctrl.activeBlock?.command).toBe('second');
    expect(ctrl.activeBlock?._pendingCommandEcho).toBe('second-wire');
    ctrl.dispose();
  });

  it('ignores an empty shell command report', () => {
    const { ctrl, feed } = wire();
    feed(`${A}${E(' ')}`);
    expect(ctrl.activeBlock?.status).toBe('pending');
    ctrl.dispose();
  });

  it('keeps an undecodable transport-looking command unchanged', () => {
    const { ctrl, feed } = wire();
    const command = "Invoke-Expression ([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('abc')))";
    feed(`${A}${E(command)}${C}`);
    expect(ctrl.activeBlock?.command).toBe(command);
    ctrl.dispose();
  });

  it('keeps commands sent to an unintegrated SSH session on the main terminal', () => {
    const { st, ctrl, feed } = wire();
    ctrl.setPendingCommand('ls');
    feed('notes.txt\r\n$ ');
    expect(st.written).toContain('notes.txt');
    expect(ctrl.blocks).toHaveLength(0);
    ctrl.dispose();
  });

  it('starts in the classic scene and writes data to the main xterm', () => {
    const { st, ctrl, feed } = wire();
    expect(ctrl.scene).toBe('classic');
    feed('no integration here\r\n');
    expect(st.written).toBe('no integration here\r\n');
    expect(ctrl.blocks.length).toBe(0);
  });

  it('keeps the prompt-end marker 133;B in the pipeline without writing it to the main xterm', () => {
    const { st, ctrl, feed } = wire();
    feed('\x1b]133;B\x07');
    expect(st.written).toBe('');
    expect(ctrl.blocks.length).toBe(0);
  });

  it('the first OSC 133;A switches to blockList and the prompt segment enters no grid', () => {
    const { st, ctrl, feed } = wire();
    feed(`${A}~/work$ `);
    expect(ctrl.scene).toBe('blockList');
    expect(st.scenes).toEqual(['blockList']);
    expect(ctrl.blocks.length).toBe(1);
    expect(ctrl.blocks[0]!.status).toBe('pending');
    // Prompt text never reaches the main xterm
    expect(st.written).toBe('');
  });

  it('full command cycle: A -> E -> C -> output -> D', async () => {
    const { st, ctrl, feed } = wire();
    feed(`${A}~/work$ ${E('ls')}${C}file1\r\nfile2\r\n${D(0)}${A}`);
    await waitFor(() => st.completed.length === 1);
    expect(st.started).toEqual(['ls']);
    expect(st.completed).toEqual(['ls']);
    const done = ctrl.blocks[0]!;
    expect(done.status).toBe('done');
    expect(done.exitCode).toBe(0);
    expect(done.outputText).toBe('file1\nfile2');
    expect(done.outputHtml).toContain('file1');
    // The A after D creates a new pending block
    expect(ctrl.blocks.length).toBe(2);
    expect(ctrl.blocks[1]!.status).toBe('pending');
  });

  it('command and output in the same chunk do not bleed across cells (garbled-text regression)', async () => {
    const { ctrl, feed } = wire();
    // C and output share a chunk: the old architecture routed output into the header because of the asynchronous parser
    feed(`${A}p$ ${E('echo hi')}${C}hi\r\n${D(0)}`);
    await waitFor(() => ctrl.blocks[0]?.outputText === 'hi');
    const b = ctrl.blocks[0]!;
    expect(b.outputText).toBe('hi');
    expect(b.command).toBe('echo hi');
  });

  it('keeps authentication and prompt repaint out of a command with its own screen origin', async () => {
    const { ctrl, feed } = wire();
    feed("user@server's password: ");
    feed(`${A}user@server's password: \r\n\x1b[9;1Hls\r\n${E('ls')}${C}\x1b[H\x1b[2Jfile.txt\r\n${D(0)}`);
    await waitFor(() => ctrl.blocks[0]?.outputText === 'file.txt');
    expect(ctrl.blocks[0]!.outputText).not.toContain('password');
    expect(ctrl.blocks[0]!.outputHtml).not.toContain('password');
  });

  it('starts PowerShell table output at the command origin after line-editor repainting', async () => {
    const { ctrl, feed } = wire();
    feed(`${A}PS> \r\n\x1b[9;1Hls\r\n${E('ls')}${C}\x1b[H\x1b[2JMode  Name\r\nd---  Documents\r\n${D(0)}`);
    await waitFor(() => ctrl.blocks[0]?.outputText?.includes('Documents') === true);
    expect(ctrl.blocks[0]!.outputText).toBe('Mode  Name\nd---  Documents');
    expect(ctrl.blocks[0]!.outputHtml).not.toContain('PS&gt;');
  });

  it('A without D marks the previous block as interrupted', () => {
    const { ctrl, feed } = wire();
    feed(`${A}p$ ${E('sleep 99')}${C}`);
    feed(A); // New prompt after Ctrl+C, without D
    expect(ctrl.blocks[0]!.status).toBe('interrupted');
    expect(ctrl.blocks[1]!.status).toBe('pending');
  });

  it('drops typeahead echoes while keeping background output', async () => {
    const { ctrl, feed } = wire();
    // Typeahead: the user typed ls ahead of time after A, so the echo matches the command
    feed(`${A}p$ ls`);
    feed(`${E('ls')}${C}out\r\n${D(0)}`);
    await waitFor(() => ctrl.blocks[0]?.outputText === 'out');
    expect(ctrl.blocks[0]!.outputText).toBe('out');
    // Background output: a job notification after A with no matching echo
    feed(`p$ [1]  done  sleep 1\r\n`);
    feed(`${E('pwd')}${C}/tmp\r\n${D(0)}`);
    await waitFor(() => ctrl.blocks[1]?.outputText?.includes('/tmp'));
    expect(ctrl.blocks[1]!.outputText).toContain('[1]  done  sleep 1');
    expect(ctrl.blocks[1]!.outputText).toContain('/tmp');
  });

  it('OSC 7 updates the cwd and notifies the sink', () => {
    const { st, ctrl, feed } = wire();
    feed(`${A}${OSC7('/Users/w/work')}`);
    expect(st.cwds).toEqual(['/Users/w/work']);
    expect(ctrl.blocks[0]!.cwd).toBe('/Users/w/work');
  });

  it('stores the normalized Windows drive path from OSC 7 in both the sink and block', () => {
    const { st, ctrl, feed } = wire();
    feed(`${A}${OSC7('/C:/Users/My Project')}`);
    expect(st.cwds).toEqual(['C:/Users/My Project']);
    expect(ctrl.blocks[0]!.cwd).toBe('C:/Users/My Project');
  });

  it('OSC 7 arriving before 133;A (the real RC order) seeds the cwd of the new pending block', () => {
    const { st, ctrl, feed } = wire();
    feed(`${OSC7('/Users/w/work')}${A}~/work$ `);
    expect(st.cwds).toEqual(['/Users/w/work']);
    expect(ctrl.blocks[0]!.cwd).toBe('/Users/w/work');
  });

  it('OSC 7 after command completion does not rewrite the old block cwd and only seeds the next block', async () => {
    const { st, ctrl, feed } = wire();
    feed(`${OSC7('/home/a')}${A}a$ ${E('cd /home/b')}${C}${OSC7('/home/b')}${D(0)}${A}b$ `);
    await waitFor(() => st.completed.length === 1);
    expect(ctrl.blocks[0]!.cwd).toBe('/home/a');   // cwd while the command ran
    expect(ctrl.blocks[1]!.cwd).toBe('/home/b');   // New pending block (current location row)
  });

  it('after clear(), later events do not backfill old blocks', async () => {
    const { st, ctrl, feed } = wire();
    feed(`${A}p$ ${E('ls')}${C}x\r\n${D(0)}${A}p$ `);
    await waitFor(() => st.completed.length === 1);
    expect(ctrl.blocks.length).toBe(2);
    ctrl.clear();
    expect(ctrl.blocks.length).toBe(0);
    feed(`${A}p$ ${E('pwd')}${C}y\r\n${D(0)}${A}p$ `);
    await waitFor(() => st.completed.length === 2);
    // Only blocks from the new command cycle exist
    expect(ctrl.blocks.length).toBe(2);
    expect(ctrl.blocks[0]!.command).toBe('pwd');
  });

  it('OSC 133;G sets the git branch', () => {
    const { ctrl, feed } = wire();
    feed(`${A}\x1b]133;G;${btoa('master')}\x07`);
    expect(ctrl.blocks[0]!.gitBranch).toBe('master');
  });

  it('altScreen: data goes to the main xterm (including alt raw and OSC raw) and exiting restores the blocks', async () => {
    const { st, ctrl, feed } = wire();
    feed(`${A}p$ ${E('vim')}${C}`);
    feed('\x1b[?1049h');
    expect(ctrl.scene).toBe('altScreen');
    feed('VIM CONTENT');
    expect(st.written).toContain('\x1b[?1049h');
    expect(st.written).toContain('VIM CONTENT');
    feed('\x1b[?1049l');
    expect(ctrl.scene).toBe('blockList');
    // Content from the alt screen never enters block output
    feed(`done\r\n${D(0)}`);
    await waitFor(() => ctrl.blocks[0]?.outputText === 'done');
    expect(ctrl.blocks[0]!.outputText).toBe('done');
  });

  it('leaving the TUI alt screen keeps full-screen frames out of block history (only shell noise after teardown remains)', async () => {
    const { ctrl, feed } = wire();
    feed(`${A}p$ ${E('vi')}${C}`);
    feed('\x1b[?1049h');
    feed('VI FULLSCREEN'); // During the alt screen it only reaches the main xterm
    feed('\x1b[?1049l');   // The full-screen frame is not backfilled into the block
    feed(`zsh: terminated  vi\r\n${D(143)}`);
    await waitFor(() => !!ctrl.blocks[0]?.outputText.includes('zsh: terminated'));
    expect(ctrl.blocks[0]!.outputText).not.toContain('VI FULLSCREEN');
  });

  it('an alt sequence combined with other DEC private modes also stays out of block history', async () => {
    const { st, ctrl, feed } = wire();
    feed(`${A}p$ ${E('htop')}${C}`);
    feed('\x1b[?1049;2004h');
    expect(ctrl.scene).toBe('altScreen');
    feed('HTOP FULLSCREEN');
    expect(st.written).toContain('\x1b[?1049;2004h');
    expect(st.written).toContain('HTOP FULLSCREEN');
    feed('\x1b[?1049;2004l');
    expect(ctrl.scene).toBe('blockList');
    feed(`done\r\n${D(0)}`);
    await waitFor(() => ctrl.blocks[0]?.outputText === 'done');
    expect(ctrl.blocks[0]!.outputText).toBe('done');
    expect(ctrl.blocks[0]!.outputText).not.toContain('HTOP FULLSCREEN');
  });

  it('classic mode forwards raw OSC to the main xterm (OSC 8/52 keep working)', () => {
    const { st, feed } = wire();
    feed('\x1b]8;;https://a.com\x07link\x1b]8;;\x07');
    expect(st.written).toContain('\x1b]8;;https://a.com\x07');
    expect(st.written).toContain('link');
  });

  it('long-running flag: executing for more than 2 seconds', () => {
    vi.useFakeTimers();
    try {
      const { ctrl, feed } = wire();
      feed(`${A}p$ ${E('npm i')}${C}`);
      vi.advanceTimersByTime(2100);
      feed('x'); // Any output triggers the check
      expect(ctrl.blocks[0]!.wasLongRunning).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('dispose must not trigger sink callbacks while finishBlock drains', async () => {
    const { st, ctrl, feed } = wire();
    feed(`${A}p$ ${E('ls')}${C}out\r\n${D(0)}`); // No trailing A
    const blocksBefore = st.blocksChanged;
    ctrl.dispose();
    // Let finishBlock's asynchronous callback window pass; if dispose failed to suppress the callback,
    // completed / blocksChanged would change and waitFor would time out.
    let stableTicks = 0;
    let lastBlocks = blocksBefore;
    await waitFor(() => {
      if (st.completed.length !== 0) return false;
      if (st.blocksChanged === lastBlocks) stableTicks++;
      else { stableTicks = 0; lastBlocks = st.blocksChanged; }
      return stableTicks >= 5;
    });
    expect(st.completed).toEqual([]);
    expect(st.blocksChanged).toBe(blocksBefore);
  });

  it('a single oversized write reports linesTruncated', async () => {
    const { st, ctrl, feed } = wire();
    const output = Array.from({ length: 6000 }, (_, i) => `line${i}`).join('\r\n') + '\r\n';
    feed(`${A}p$ ${E('cat')}${C}${output}${D(0)}`);
    await new Promise<void>((resolve) => {
      const check = () => {
        if (st.completed.length > 0) resolve();
        else setTimeout(check, 10);
      };
      check();
    });
    expect(ctrl.blocks[0]!.linesTruncated).toBe(977);
  }, 30000);

  it('keeps output beyond the viewport without reporting it as truncated', async () => {
    const { st, ctrl, feed } = wire();
    const lines = Array.from({ length: 100 }, (_, i) => `retained-line-${i}`);
    feed(`${A}${E('git --help')}${C}${lines.join('\r\n')}\r\n${D(0)}`);
    await waitFor(() => st.completed.length === 1);
    expect(ctrl.blocks[0]!.linesTruncated).toBe(0);
    expect(ctrl.blocks[0]!.outputText).toContain(lines[0]);
    expect(ctrl.blocks[0]!.outputText).toContain(lines[99]);
  });

  it('finishBlock triggers enforceBlockCap and drops old block output', async () => {
    const { st, ctrl, feed } = wire();
    for (let i = 0; i < 201; i++) {
      feed(`${A}p$ ${E(`cmd${i}`)}${C}x\r\n${D(0)}`);
    }
    await new Promise<void>((resolve) => {
      const check = () => {
        if (st.completed.length === 201) resolve();
        else setTimeout(check, 10);
      };
      check();
    });
    expect(ctrl.blocks.length).toBe(201);
    expect(ctrl.blocks[0]!.outputHtml).toBe('');
    expect(ctrl.blocks[0]!.outputText).toBe('');
    expect(ctrl.blocks[200]!.outputText).toContain('x');
  }, 30000);
});
