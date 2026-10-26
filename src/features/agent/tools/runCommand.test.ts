/**
 * runCommandAndWait 测试：mock PTY 边界，用真实 blockStore 模拟块生命周期。
 * 覆盖：块模式完成（exitCode + agent 标记）、无会话、altScreen 拒绝、超时。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@platform/pty', () => ({
  ptyWrite: vi.fn(async () => {}),
}));

import { runCommandAndWait } from '@features/agent/tools/runCommand';
import { useBlockStore } from '@features/terminal/stores/blocks';
import { useTerminalStore } from '@features/terminal/stores/terminal';
import { useSessionStore } from '@features/workspace';
import { agentControl } from '@features/agent/services/agentControl';
import type { TermBlock } from '@features/terminal/services/pipeline/termBlock';

const initialBlocks = useBlockStore.getState();
const initialTerm = useTerminalStore.getState();
const initialWs = useSessionStore.getState();

function setupPane(): string {
  // 模拟启动后存在活跃标签（store 不再内置初始标签）
  useSessionStore.getState().addTab({});
  const tabId = useSessionStore.getState().activeId;
  const paneId = `${tabId}#0`;
  useTerminalStore.setState((s) => ({ sessions: { ...s.sessions, [paneId]: 'pty-1' } }));
  return paneId;
}

function mkBlock(p: Partial<TermBlock>): TermBlock {
  return {
    id: 'b1',
    command: 'ls',
    status: 'executing',
    exitCode: null,
    // 认领判据是 startedAt >= 调用时刻 t0（preexec 在写入之后），
    // 默认取「现在」模拟命令刚启动；t0 之前的旧块需显式传小时间戳
    startedAt: Date.now(),
    endedAt: null,
    wasLongRunning: false,
    outputHtml: '',
    outputText: '',
    outputRaw: '',
    linesTruncated: 0,
    ...p,
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('runCommandAndWait', () => {
  it('reschedules completion after a later statement outlives the snapshot grace period', async () => {
    vi.useFakeTimers();
    const paneId = setupPane();
    const pending = runCommandAndWait('first\nsecond', { paneId });
    await vi.advanceTimersByTimeAsync(0);
    useBlockStore.getState().addBlock(paneId, mkBlock({ id: 'first', command: 'first' }));
    useBlockStore.getState().updateBlock(paneId, 'first', { status: 'done', exitCode: 0 });
    useBlockStore.getState().addBlock(paneId, mkBlock({ id: 'second', command: 'second' }));
    await vi.advanceTimersByTimeAsync(400);
    useBlockStore.getState().updateBlock(paneId, 'second', { status: 'done', exitCode: 0, outputText: 'complete' });
    await vi.advanceTimersByTimeAsync(350);
    await expect(pending).resolves.toMatchObject({ ok: true, completed: true, output: expect.stringContaining('complete') });
  });
  it('reports a disconnected execution target before sending a command', async () => {
    const result = await runCommandAndWait('echo test', { paneId: 'missing' });
    expect(result).toMatchObject({ ok: false, completed: false, code: 'TERMINAL_DISCONNECTED', requiresUserAction: true });
  });

  it.each(['closed', 'replacement'])('settles immediately when the execution target becomes %s', async state => {
    const paneId = setupPane();
    const pending = runCommandAndWait('echo test', { paneId });
    await tick();
    useTerminalStore.setState({ sessions: state === 'closed' ? {} : { [paneId]: 'different-process' } });
    await expect(pending).resolves.toMatchObject({ ok: false, completed: false, code: 'TERMINAL_DISCONNECTED', requiresUserAction: true });
  });
  beforeEach(() => {
    useBlockStore.setState(initialBlocks, true);
    useTerminalStore.setState(initialTerm, true);
    useSessionStore.setState(initialWs, true);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('块模式：新块转 done → 返回退出码与输出，块被打 agent 标记', async () => {
    const paneId = setupPane();
    const promise = runCommandAndWait('ls');
    await tick(); // 等 ptyWrite 落完、订阅就位
    expect(agentControl.isControlled(paneId)).toBe(true);

    useBlockStore.getState().addBlock(paneId, mkBlock({}));
    await tick();
    // 认领后打上投影标记
    expect(useBlockStore.getState().byTab[paneId]![0]!.agent).toBe(true);

    useBlockStore.getState().updateBlock(paneId, 'b1', {
      status: 'done',
      exitCode: 0,
      endedAt: 2,
      outputText: 'a.txt\nb.txt',
    });
    const r = await promise;
    expect(r).toMatchObject({ ok: true, exitCode: 0, output: 'a.txt\nb.txt' });
    expect(agentControl.isControlled(paneId)).toBe(false);
  });

  // Regression: one submitted script can become several blocks (PowerShell runs a multi-line
  // script statement by statement). Returning a single block handed the model just its last line.
  it('块模式：多行脚本拆成多个块时返回每个块的命令与输出', async () => {
    const paneId = setupPane();
    const promise = runCommandAndWait('$f = "x"\nSet-Content $f "hi"\nRemove-Item $f -Force');
    await tick();

    useBlockStore.getState().addBlock(paneId, mkBlock({ id: 'b1', command: '$f = "x"' }));
    await tick();
    useBlockStore.getState().updateBlock(paneId, 'b1', { status: 'done', exitCode: 0 });
    useBlockStore.getState().addBlock(paneId, mkBlock({ id: 'b2', command: 'Set-Content $f "hi"' }));
    await tick();
    useBlockStore.getState().updateBlock(paneId, 'b2', { status: 'done', exitCode: 0, outputText: '写入完成' });
    useBlockStore.getState().addBlock(paneId, mkBlock({ id: 'b3', command: 'Remove-Item $f -Force' }));
    await tick();
    useBlockStore.getState().updateBlock(paneId, 'b3', { status: 'done', exitCode: 0, outputText: '删除成功' });

    await new Promise((r) => setTimeout(r, 400));
    const r = await promise;
    expect(r).toMatchObject({ ok: true, completed: true, exitCode: 0 });
    expect(r.output).toContain('$ $f = "x"');
    expect(r.output).toContain('$ Set-Content $f "hi"\n写入完成');
    expect(r.output).toContain('$ Remove-Item $f -Force\n删除成功');
    for (const id of ['b1', 'b2', 'b3']) expect(agentControl.hasBlock(id)).toBe(true);
  });

  it('块模式：本次提交之外的块不计入结果', async () => {
    const paneId = setupPane();
    const promise = runCommandAndWait('echo mine');
    await tick();
    useBlockStore.getState().addBlock(paneId, mkBlock({ id: 'mine', command: 'echo mine' }));
    // 用户并发敲的命令：不属于本次提交，不能并进模型看到的结果
    useBlockStore.getState().addBlock(paneId, mkBlock({ id: 'user', command: 'git status' }));
    await tick();
    useBlockStore.getState().updateBlock(paneId, 'mine', { status: 'done', exitCode: 0, outputText: 'mine' });
    useBlockStore.getState().updateBlock(paneId, 'user', { status: 'done', exitCode: 0, outputText: 'user output' });

    await new Promise((r) => setTimeout(r, 400));
    const r = await promise;
    expect(r.output).toBe('mine');
    expect(agentControl.hasBlock('user')).toBe(false);
    expect(agentControl.hasBlock('mine')).toBe(true);
  });

  it('块模式：多块之中有一步失败 → ok:false 并给出该步退出码', async () => {    const paneId = setupPane();
    const promise = runCommandAndWait('step one\nstep two');
    await tick();
    useBlockStore.getState().addBlock(paneId, mkBlock({ id: 'b1', command: 'step one' }));
    await tick();
    useBlockStore.getState().updateBlock(paneId, 'b1', { status: 'done', exitCode: 0, outputText: 'ok' });
    useBlockStore.getState().addBlock(paneId, mkBlock({ id: 'b2', command: 'step two' }));
    await tick();
    useBlockStore.getState().updateBlock(paneId, 'b2', { status: 'done', exitCode: 3, outputText: 'missing' });

    await new Promise((r) => setTimeout(r, 400));
    const r = await promise;
    expect(r.ok).toBe(false);
    expect(r.completed).toBe(true);
    expect(r.exitCode).toBe(3);
    expect(r.error).toContain('3');
  });

  it('超长输出保留头部与尾部，并标明省略', async () => {
    const paneId = setupPane();
    const promise = runCommandAndWait('big');
    await tick();
    useBlockStore.getState().addBlock(paneId, mkBlock({ id: 'b1', command: 'big' }));
    await tick();
    useBlockStore.getState().updateBlock(paneId, 'b1', {
      status: 'done',
      exitCode: 0,
      outputText: `HEAD-MARKER\n${'x'.repeat(20_000)}\nTAIL-MARKER`,
    });

    await new Promise((r) => setTimeout(r, 400));
    const r = await promise;
    expect(r.output).toContain('HEAD-MARKER');
    expect(r.output).toContain('TAIL-MARKER');
    expect(r.output).toContain('字符已省略');
    expect(r.output.length).toBeLessThan(8300);
  });

  it('块模式：非零退出码 → ok:false 带错误说明', async () => {    const paneId = setupPane();
    const promise = runCommandAndWait('ls');
    await tick();
    useBlockStore.getState().addBlock(paneId, mkBlock({}));
    await tick();
    useBlockStore.getState().updateBlock(paneId, 'b1', {
      status: 'done',
      exitCode: 2,
      endedAt: 2,
      outputText: 'No such file',
    });
    const r = await promise;
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(2);
    expect(r.error).toContain('2');
  });

  it('无终端会话 → 结构化错误（不 throw）', async () => {
    const r = await runCommandAndWait('ls');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('没有可用的终端会话');
  });

  it('altScreen 全屏应用 → 拒绝执行', async () => {
    const paneId = setupPane();
    useTerminalStore.setState((s) => ({ scenes: { ...s.scenes, [paneId]: 'altScreen' } }));
    const r = await runCommandAndWait('ls');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('altScreen');
  });

  it('超时 → 返回部分输出与超时说明', async () => {
    vi.useFakeTimers();
    setupPane();
    const promise = runCommandAndWait('sleep 999', { timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(100);
    const r = await promise;
    expect(r.ok).toBe(false);
    expect(r.error).toContain('超时');
  });

  it('never treats a quiet terminal snapshot as successful completion', async () => {
    vi.useFakeTimers();
    setupPane();
    const promise = runCommandAndWait('ls');
    // 1500ms 宽限（无块）→ 快照模式；输出稳定 2×500ms 后完成
    await vi.advanceTimersByTimeAsync(3000);
    const r = await promise;
    expect(r.ok).toBe(false);
    expect(r.completed).toBe(false);
    expect(r.error).toContain('无法确认');
  });

  it('宽限期自愈：订阅错过的块在 1500ms 直扫时认领', async () => {
    vi.useFakeTimers();
    const paneId = setupPane();
    const promise = runCommandAndWait('ls');
    // 订阅就位前块已存在且直接 done（模拟事件时序错过）
    await vi.advanceTimersByTimeAsync(10);
    useBlockStore.setState((s) => ({
      byTab: {
        ...s.byTab,
        [paneId]: [mkBlock({ status: 'done', exitCode: 0, endedAt: 2, outputText: 'x' })],
      },
    }));
    // setState 会触发订阅（正常认领）；此处主要验证不降级快照
    await vi.advanceTimersByTimeAsync(2000);
    const r = await promise;
    expect(r).toMatchObject({ ok: true, exitCode: 0, output: 'x' });
    expect(agentControl.hasBlock('b1')).toBe(true);
  });

  it('回归：预存在的 pending 提示符块转 executing 后被认领（真实生命周期）', async () => {
    const paneId = setupPane();
    // 提示符绘制时（133;A）就建好的 pending 空块 —— 它是本命令未来的家
    useBlockStore.getState().addBlock(
      paneId,
      mkBlock({ id: 'prompt', command: '', status: 'pending', startedAt: null }),
    );
    const promise = runCommandAndWait('ls');
    await tick();
    // 写入后：133;E/C 到达，同一块转 executing 并填上命令
    useBlockStore.getState().updateBlock(paneId, 'prompt', {
      command: 'ls',
      status: 'executing',
      startedAt: Date.now(),
    });
    await tick();
    expect(agentControl.hasBlock('prompt')).toBe(true);

    useBlockStore.getState().updateBlock(paneId, 'prompt', {
      status: 'done',
      exitCode: 0,
      endedAt: Date.now(),
      outputText: 'a.txt\nb.txt',
    });
    const r = await promise;
    expect(r).toMatchObject({ ok: true, exitCode: 0, output: 'a.txt\nb.txt' });
  });

  it('t0 之前的同名旧块不被认领（无新块 → 快照降级）', async () => {
    vi.useFakeTimers();
    const paneId = setupPane();
    // 用户一小时前手动跑过 ls —— 不能误认成我们的块
    useBlockStore.getState().addBlock(
      paneId,
      mkBlock({ id: 'old', status: 'done', exitCode: 0, startedAt: 1, outputText: 'stale' }),
    );
    const promise = runCommandAndWait('ls');
    await vi.advanceTimersByTimeAsync(3000);
    const r = await promise;
    expect(agentControl.hasBlock('old')).toBe(false);
    expect(r.exitCode).toBeUndefined(); // 快照模式无退出码
    expect(r.completed).toBe(false);
    expect(r.error).toContain('无法确认');
  });

  it('执行中途切入 altScreen（TUI）→ 立即收口，不干等超时', async () => {
    vi.useFakeTimers();
    const paneId = setupPane();
    const promise = runCommandAndWait('claude');
    await vi.advanceTimersByTimeAsync(10);
    // 命令把终端切进全屏交互（vim/claude 这类 TUI）
    useTerminalStore.setState((s) => ({ scenes: { ...s.scenes, [paneId]: 'altScreen' } }));
    const r = await promise;
    expect(r.ok).toBe(false);
    expect(r.error).toContain('全屏交互界面');
  });

  it('认领时记录 toolCall→block 映射（内嵌命令块渲染用）', async () => {
    const paneId = setupPane();
    const promise = runCommandAndWait('ls', { toolCallId: 'tc-1' });
    await tick();
    useBlockStore.getState().addBlock(paneId, mkBlock({}));
    await tick();
    expect(agentControl.blockForToolCall('tc-1')).toBe('b1');
    useBlockStore.getState().updateBlock(paneId, 'b1', {
      status: 'done',
      exitCode: 0,
      endedAt: Date.now(),
      outputText: 'x',
    });
    await promise;
  });
});
