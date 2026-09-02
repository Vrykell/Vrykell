import { describe, it, expect, vi } from 'vitest';
import { SessionController, type SessionSinks } from '../sessionController';
import { ScanHelper } from './scanHelper';

function wire(tabId = 't1') {
  const st = {
    written: '',
    blocksChanged: 0,
    scenes: [] as string[],
    cwds: [] as string[],
    started: [] as string[],
    completed: [] as string[],
  };
  const sinks: SessionSinks = {
    writeMain: (d) => { st.written += d; },
    onBlocksChanged: () => { st.blocksChanged++; },
    onSceneChanged: (s) => { st.scenes.push(s); },
    onCwd: (p) => { st.cwds.push(p); },
    onBlockStart: (b) => { st.started.push(b.command); },
    onBlockComplete: (b) => { st.completed.push(b.command); },
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
  it('初始场景为 classic，数据进主 xterm', () => {
    const { st, ctrl, feed } = wire();
    expect(ctrl.scene).toBe('classic');
    feed('no integration here\r\n');
    expect(st.written).toBe('no integration here\r\n');
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
    expect(ctrl.blocks[0]!.linesTruncated).toBeGreaterThan(0);
  }, 30000);

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
