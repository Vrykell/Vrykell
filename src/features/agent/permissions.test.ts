/**
 * permissions — the webview side of authorization: the gate flow over the injected
 * authorizer, the approval bridge and the level mirror.
 *
 * The rule tables (danger commands, credential paths, durable actions) live in Rust and are
 * covered by cargo tests in src-tauri/src/agent/permissions.rs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
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
  usePermissions.setState({ levels: { ...DEFAULT_LEVELS }, mode: 'standard' });
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
