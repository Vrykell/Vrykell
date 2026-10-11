import { describe, it, expect, vi } from 'vitest';
import { SessionController, type SessionSinks } from '@features/terminal/services/pipeline/sessionController';
import { ScanHelper } from '@features/terminal/services/pipeline/__tests__/scanHelper';

function wire(tabId = 't1') {
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
  const sinks: SessionSinks = {
    writeMain: (d) => { st.written += d; },
    onBlocksChanged: () => { st.blocksChanged++; },
    onSceneChanged: (s) => { st.scenes.push(s); },
    onCwd: (p) => { st.cwds.push(p); },
    onBlockStart: (b) => { st.started.push(b.command); },
    onBlockComplete: (b) => { st.completed.push(b.command); },
    onTerminalData: data => { st.replies.push(data); },
    onProgramTitle: (title) => { st.programTitles.push(title); },
  };
  const ctrl = new SessionController(tabId, 80, sinks);
  const scan = new ScanHelper();
  const feed = (chunk: string) => ctrl.handleEvents(scan.push(chunk));
  return { st, ctrl, feed };
}

const A = '\x1b]133;A\x07';
const C = '\x1b]133;C\x07';
const D = (ec: number) => `\x1b]133;D;${ec}\x07`;
const E = (cmd: string) => `\x1b]133;E;${btoa(cmd)}\x07`;
const OSC7 = (p: string) => `\x1b]7;file://host${p}\x07`;

// xterm write 是异步队列；finishBlock 用空写回调排空后才提取快照。
// 轮询等待谓词成立（并发全量跑时固定延时不可靠）。
async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor 超时');
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

  it('keeps commands sent to an unintegrated SSH session on the main terminal', () => {
    const { st, ctrl, feed } = wire();
    ctrl.setPendingCommand('ls');
    feed('notes.txt\r\n$ ');
    expect(st.written).toContain('notes.txt');
    expect(ctrl.blocks).toHaveLength(0);
    ctrl.dispose();
  });

  it('初始场景为 classic，数据进主 xterm', () => {
    const { st, ctrl, feed } = wire();
    expect(ctrl.scene).toBe('classic');
    feed('no integration here\r\n');
    expect(st.written).toBe('no integration here\r\n');
    expect(ctrl.blocks.length).toBe(0);
  });

  it('prompt-end 标记 133;B 保留在管线内，不写入主 xterm', () => {
    const { st, ctrl, feed } = wire();
    feed('\x1b]133;B\x07');
    expect(st.written).toBe('');
    expect(ctrl.blocks.length).toBe(0);
  });

  it('首个 OSC 133;A 切到 blockList，prompt 段不进任何 grid', () => {
    const { st, ctrl, feed } = wire();
    feed(`${A}~/work$ `);
    expect(ctrl.scene).toBe('blockList');
    expect(st.scenes).toEqual(['blockList']);
    expect(ctrl.blocks.length).toBe(1);
    expect(ctrl.blocks[0]!.status).toBe('pending');
    // prompt 文本不进主 xterm
    expect(st.written).toBe('');
  });

  it('完整命令周期：A→E→C→输出→D', async () => {
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
    // D 后的 A 创建了新 pending block
    expect(ctrl.blocks.length).toBe(2);
    expect(ctrl.blocks[1]!.status).toBe('pending');
  });

  it('命令与输出在同一 chunk 也不串格（乱码回归）', async () => {
    const { ctrl, feed } = wire();
    // C 和输出同 chunk：旧架构因异步 parser 会把输出路由进 header
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

  it('无 D 直接 A → 上个 block 标记 interrupted', () => {
    const { ctrl, feed } = wire();
    feed(`${A}p$ ${E('sleep 99')}${C}`);
    feed(A); // Ctrl+C 后新 prompt，无 D
    expect(ctrl.blocks[0]!.status).toBe('interrupted');
    expect(ctrl.blocks[1]!.status).toBe('pending');
  });

  it('typeahead 回显丢弃，后台输出保留', async () => {
    const { ctrl, feed } = wire();
    // typeahead：A 后用户提前敲了 ls，回显与命令一致
    feed(`${A}p$ ls`);
    feed(`${E('ls')}${C}out\r\n${D(0)}`);
    await waitFor(() => ctrl.blocks[0]?.outputText === 'out');
    expect(ctrl.blocks[0]!.outputText).toBe('out');
    // 后台输出：A 后 job 通知（无回显匹配）
    feed(`p$ [1]  done  sleep 1\r\n`);
    feed(`${E('pwd')}${C}/tmp\r\n${D(0)}`);
    await waitFor(() => ctrl.blocks[1]?.outputText?.includes('/tmp'));
    expect(ctrl.blocks[1]!.outputText).toContain('[1]  done  sleep 1');
    expect(ctrl.blocks[1]!.outputText).toContain('/tmp');
  });

  it('OSC 7 更新 cwd 并回调', () => {
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

  it('OSC 7 在 133;A 之前到达（真实 RC 顺序）：cwd 播种到新 pending block', () => {
    const { st, ctrl, feed } = wire();
    feed(`${OSC7('/Users/w/work')}${A}~/work$ `);
    expect(st.cwds).toEqual(['/Users/w/work']);
    expect(ctrl.blocks[0]!.cwd).toBe('/Users/w/work');
  });

  it('命令完成后的 OSC 7 不改写旧 block 的 cwd，只播种下一个 block', async () => {
    const { st, ctrl, feed } = wire();
    feed(`${OSC7('/home/a')}${A}a$ ${E('cd /home/b')}${C}${OSC7('/home/b')}${D(0)}${A}b$ `);
    await waitFor(() => st.completed.length === 1);
    expect(ctrl.blocks[0]!.cwd).toBe('/home/a');   // 命令执行时的 cwd
    expect(ctrl.blocks[1]!.cwd).toBe('/home/b');   // 新 pending（当前位置行）
  });

  it('clear() 清空后，后续事件不回填旧 block', async () => {
    const { st, ctrl, feed } = wire();
    feed(`${A}p$ ${E('ls')}${C}x\r\n${D(0)}${A}p$ `);
    await waitFor(() => st.completed.length === 1);
    expect(ctrl.blocks.length).toBe(2);
    ctrl.clear();
    expect(ctrl.blocks.length).toBe(0);
    feed(`${A}p$ ${E('pwd')}${C}y\r\n${D(0)}${A}p$ `);
    await waitFor(() => st.completed.length === 2);
    // 只有新命令周期产生的 block
    expect(ctrl.blocks.length).toBe(2);
    expect(ctrl.blocks[0]!.command).toBe('pwd');
  });

  it('OSC 133;G 设置 git 分支', () => {
    const { ctrl, feed } = wire();
    feed(`${A}\x1b]133;G;${btoa('master')}\x07`);
    expect(ctrl.blocks[0]!.gitBranch).toBe('master');
  });

  it('altScreen：数据转主 xterm（含 alt raw 与 OSC raw），退出恢复', async () => {
    const { st, ctrl, feed } = wire();
    feed(`${A}p$ ${E('vim')}${C}`);
    feed('\x1b[?1049h');
    expect(ctrl.scene).toBe('altScreen');
    feed('VIM CONTENT');
    expect(st.written).toContain('\x1b[?1049h');
    expect(st.written).toContain('VIM CONTENT');
    feed('\x1b[?1049l');
    expect(ctrl.scene).toBe('blockList');
    // alt 期间内容不进 block 输出
    feed(`done\r\n${D(0)}`);
    await waitFor(() => ctrl.blocks[0]?.outputText === 'done');
    expect(ctrl.blocks[0]!.outputText).toBe('done');
  });

  it('TUI 退出 alt：全屏画面不进块历史（只留 teardown 后的 shell 噪音）', async () => {
    const { ctrl, feed } = wire();
    feed(`${A}p$ ${E('vi')}${C}`);
    feed('\x1b[?1049h');
    feed('VI FULLSCREEN'); // alt 期间只进主 xterm
    feed('\x1b[?1049l');   // 全屏画面不回填进块
    feed(`zsh: terminated  vi\r\n${D(143)}`);
    await waitFor(() => !!ctrl.blocks[0]?.outputText.includes('zsh: terminated'));
    expect(ctrl.blocks[0]!.outputText).not.toContain('VI FULLSCREEN');
  });

  it('classic 模式下 OSC raw 转发主 xterm（OSC 8/52 不失效）', () => {
    const { st, feed } = wire();
    feed('\x1b]8;;https://a.com\x07link\x1b]8;;\x07');
    expect(st.written).toContain('\x1b]8;;https://a.com\x07');
    expect(st.written).toContain('link');
  });

  it('长运行标记：executing 超 2 秒', () => {
    vi.useFakeTimers();
    try {
      const { ctrl, feed } = wire();
      feed(`${A}p$ ${E('npm i')}${C}`);
      vi.advanceTimersByTime(2100);
      feed('x'); // 任意输出触发检查
      expect(ctrl.blocks[0]!.wasLongRunning).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('dispose 在 finishBlock 排空期间不应再触发 sink 回调', async () => {
    const { st, ctrl, feed } = wire();
    feed(`${A}p$ ${E('ls')}${C}out\r\n${D(0)}`); // 不 trailing A
    const blocksBefore = st.blocksChanged;
    ctrl.dispose();
    // 等 finishBlock 的异步 callback 执行窗口过去；若 dispose 未抑制回调，
    // completed / blocksChanged 会变化，waitFor 将超时。
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

  it('单次大写入溢出应统计 linesTruncated', async () => {
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

  it('finishBlock 触发 enforceBlockCap，旧 block 输出被丢弃', async () => {
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
