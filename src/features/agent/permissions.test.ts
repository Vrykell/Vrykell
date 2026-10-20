/**
 * permissions — the webview side of authorization: the gate flow over the injected
 * authorizer, the approval bridge and the level mirror.
 *
 * The rule tables (danger commands, credential paths, durable actions) live in Rust and are
 * covered by cargo tests in src-tauri/src/agent/permissions.rs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '@ui/Toast';
import {
  DEFAULT_APPROVAL_TIMEOUT_SECONDS,
  DEFAULT_LEVELS,
  denyAllPending,
  gate,
  levelOf,
  resolveApproval,
  setToolApprover,
  setToolAuthorizer,
  usePermissions,
  type ToolContext,
} from '@features/agent/stores/permissions';
import type { ToolDecision } from '@features/agent/services/toolPolicy';

const allow = (lease = 'lease-1'): ToolDecision => ({ decision: 'allow', lease });
const ASK: ToolDecision = { decision: 'ask' };

function reset() {
  usePermissions.setState({
    levels: { ...DEFAULT_LEVELS },
    mode: 'standard',
    approvalTimeoutSeconds: DEFAULT_APPROVAL_TIMEOUT_SECONDS,
  });
  denyAllPending();
  setToolAuthorizer(null);
  setToolApprover(null);
}

afterEach(() => reset());

interface StateRecord {
  states: Array<{ id: string; state: string; extra?: { danger?: string } }>;
}

function mkCtx(tabId = 't1'): ToolContext & StateRecord {
  const states: StateRecord['states'] = [];
  return {
    tabId,
    states,
    setToolState: (id, state, extra) => {
      states.push({ id, state, extra });
    },
  };
}

describe('gate', () => {
  it('allow：带回租约且不打扰用户', async () => {
    reset();
    setToolAuthorizer(async () => allow('lease-x'));
    const ctx = mkCtx();
    const g = await gate('read_file', { path: '/a', maxBytes: null }, 'tc1', ctx, 'read_file_text');
    expect(g).toEqual({ proceed: true, lease: 'lease-x' });
    expect(ctx.states).toEqual([]);
  });

  it('ask：先 approval-pending，用户允许后由后端签发租约', async () => {
    reset();
    setToolAuthorizer(async () => ASK);
    setToolApprover(async (tool, command, _args, scope) => {
      expect([tool, command, scope]).toEqual(['write_file', 'write_file_text', 'session']);
      return allow('lease-y');
    });
    const ctx = mkCtx();
    const p = gate('write_file', { path: '/x', content: 'c' }, 'tc1', ctx, 'write_file_text');
    await vi.waitFor(() => expect(ctx.states).toEqual([{ id: 'tc1', state: 'approval-pending', extra: undefined }]));
    resolveApproval('tc1', 'session');
    expect(await p).toEqual({ proceed: true, lease: 'lease-y' });
    expect(ctx.states.map((s) => s.state)).toEqual(['approval-pending', 'running']);
  });

  it('ask：用户拒绝 → denied 哨兵，不落 running', async () => {
    reset();
    setToolAuthorizer(async () => ASK);
    const ctx = mkCtx();
    const p = gate('write_file', { path: '/x' }, 'tc1', ctx, 'write_file_text');
    await vi.waitFor(() => expect(ctx.states).toHaveLength(1));
    resolveApproval('tc1', 'deny');
    const g = await p;
    expect(g.proceed).toBe(false);
    if (!g.proceed) {
      expect(g.result).toEqual({ ok: false, denied: true, error: '用户拒绝了本次操作' });
    }
    expect(ctx.states.map((s) => s.state)).toEqual(['approval-pending', 'denied']);
  });

  it('后端 deny：带原因直接拒绝，节点转灰环', async () => {
    reset();
    setToolAuthorizer(async () => ({ decision: 'deny', reason: 'danger.recursive_delete' }));
    const ctx = mkCtx();
    const g = await gate('run_command', { command: 'rm -rf /' }, 'tc1', ctx);
    expect(g.proceed).toBe(false);
    if (!g.proceed) {
      expect(g.result.denied).toBe(true);
      expect(g.result.error).toContain('递归/强制删除');
    }
    expect(ctx.states).toEqual([
      { id: 'tc1', state: 'denied', extra: { danger: '递归/强制删除文件' } },
    ]);
  });

  it('retains the reviewed command in the execution outcome and visible tool state', async () => {
    reset();
    setToolAuthorizer(async () => ASK);
    setToolApprover(async () => allow('lease-e'));
    const updates: Array<unknown> = [];
    const waiting = gate('run_command', { command: 'ls' }, 'edited', {
      tabId: 't1',
      setToolState: (_id, state, extra) => updates.push({ state, extra }),
    });
    await vi.waitFor(() => expect(updates.length).toBeGreaterThan(0));
    resolveApproval('edited', 'once', 'pwd');
    expect(await waiting).toEqual({ proceed: true, lease: 'lease-e', command: 'pwd' });
    expect(updates[updates.length - 1]).toEqual({ state: 'running', extra: { input: { command: 'pwd' } } });
  });

  it('refuses an empty edited command without granting future session access', async () => {
    reset();
    setToolAuthorizer(async () => ASK);
    setToolApprover(async () => allow());
    const ctx = mkCtx();
    const first = gate('run_command', { command: 'ls' }, 'blank', ctx);
    await vi.waitFor(() => expect(ctx.states.some((entry) => entry.state === 'approval-pending')).toBe(true));
    resolveApproval('blank', 'session', '  ');
    expect(await first).toMatchObject({ proceed: false, result: { denied: true } });
    // The refusal minted no session grant, so the next call still asks.
    const second = gate('run_command', { command: 'pwd' }, 'retry', ctx);
    await vi.waitFor(() => expect(ctx.states[ctx.states.length - 1]?.state).toBe('approval-pending'));
    resolveApproval('retry', 'deny');
    await second;
  });

  it('授权后端不可用：失败关闭', async () => {
    reset();
    setToolAuthorizer(async () => {
      throw new Error('ipc down');
    });
    const g = await gate('read_file', { path: '/a' }, 'tc1', mkCtx(), 'read_file_text');
    expect(g.proceed).toBe(false);
    if (!g.proceed) expect(g.result.denied).toBe(true);
  });

  it('无交互上下文（缺 tabId/setToolState）的 ask 按拒绝处理', async () => {
    reset();
    setToolAuthorizer(async () => ASK);
    const g = await gate('write_file', { path: '/x' }, 'tc1', {}, 'write_file_text');
    expect(g.proceed).toBe(false);
    if (!g.proceed) expect(g.result.error).toContain('无法发起审批');
  });

  it('shape：卡片拿到后端派生的形态，作答时按形态回传', async () => {
    reset();
    setToolAuthorizer(async () => ({ decision: 'ask', shape: 'npm run' }));
    setToolApprover(async (tool, command, _args, scope) => {
      expect([tool, command, scope]).toEqual(['run_command', undefined, 'shape']);
      return allow('lease-s');
    });
    const ctx = mkCtx();
    const p = gate('run_command', { command: 'npm run build' }, 'tc1', ctx);
    await vi.waitFor(() => expect(ctx.states).toEqual([
      { id: 'tc1', state: 'approval-pending', extra: { shape: 'npm run' } },
    ]));
    resolveApproval('tc1', 'shape');
    expect(await p).toEqual({ proceed: true, lease: 'lease-s' });
    expect(ctx.states.map((s) => s.state)).toEqual(['approval-pending', 'running']);
  });

  it('denyAllPending：挂起审批按拒绝放行（防悬挂）', async () => {
    reset();
    setToolAuthorizer(async () => ASK);
    const ctx = mkCtx();
    const p = gate('run_command', { command: 'ls' }, 'tc1', ctx);
    await vi.waitFor(() => expect(ctx.states).toHaveLength(1));
    denyAllPending();
    const g = await p;
    expect(g.proceed).toBe(false);
    expect(ctx.states.map((s) => s.state)).toEqual(['approval-pending', 'denied']);
  });
});

describe('审批超时（无人应答）', () => {
  it('到期自动拒绝：卡片留原因、提示条说明、轮次继续', async () => {
    vi.useFakeTimers();
    try {
      reset();
      usePermissions.setState({ approvalTimeoutSeconds: 3 });
      setToolAuthorizer(async () => ASK);
      useToastStore.setState({ toasts: [], timers: {} });
      const ctx = mkCtx();
      const p = gate('run_command', { command: 'echo hi' }, 'tc1', ctx);
      await vi.advanceTimersByTimeAsync(0);
      expect(ctx.states.map((s) => s.state)).toEqual(['approval-pending']);

      await vi.advanceTimersByTimeAsync(3000);
      const g = await p;
      expect(g.proceed).toBe(false);
      if (!g.proceed) {
        expect(g.result.denied).toBe(true);
        expect(g.result.error).toContain('等待 1 分钟无人应答');
      }
      expect(ctx.states.map((s) => s.state)).toEqual(['approval-pending', 'denied']);
      expect(ctx.states[1]?.extra?.danger).toContain('已自动拒绝本次操作');
      expect(useToastStore.getState().toasts.map((toast) => toast.message))
        .toEqual(['等待 1 分钟无人应答，已自动拒绝本次操作。']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('到期前作答照常生效，超时定时器不再触发', async () => {
    vi.useFakeTimers();
    try {
      reset();
      usePermissions.setState({ approvalTimeoutSeconds: 3 });
      setToolAuthorizer(async () => ASK);
      setToolApprover(async () => allow('lease-t'));
      useToastStore.setState({ toasts: [], timers: {} });
      const ctx = mkCtx();
      const p = gate('write_file', { path: '/x' }, 'tc1', ctx, 'write_file_text');
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1000);
      resolveApproval('tc1', 'once');
      await vi.advanceTimersByTimeAsync(5000);
      expect(await p).toEqual({ proceed: true, lease: 'lease-t' });
      expect(ctx.states.map((s) => s.state)).toEqual(['approval-pending', 'running']);
      expect(useToastStore.getState().toasts).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('设定值夹在 1–30 分钟之间', () => {
    reset();
    expect(usePermissions.getState().approvalTimeoutSeconds).toBe(DEFAULT_APPROVAL_TIMEOUT_SECONDS);
    const set = usePermissions.getState().setApprovalTimeout;
    set(600);
    expect(usePermissions.getState().approvalTimeoutSeconds).toBe(600);
    set(5);
    expect(usePermissions.getState().approvalTimeoutSeconds).toBe(60);
    set(99999);
    expect(usePermissions.getState().approvalTimeoutSeconds).toBe(1800);
  });
});

describe('levelOf（镜像 + UI 模式）', () => {
  it('standard 用镜像表，strict 全部询问，relaxed 全部放行', () => {
    reset();
    expect(levelOf('read_file')).toBe('allow');
    expect(levelOf('run_command')).toBe('ask');
    expect(levelOf('not-a-tool')).toBe('ask');

    usePermissions.getState().setMode('strict');
    expect(levelOf('read_file')).toBe('ask');

    usePermissions.getState().setMode('relaxed');
    expect(levelOf('run_command')).toBe('allow');
  });
});
