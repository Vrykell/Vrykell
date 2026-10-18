/**
 * Harness usage recording — what an ACP server reports about its own sessions reaches the panel.
 *
 * The protocol carries session totals (turns, tool calls, context window in use, cost) and no
 * per-turn token counts. The notification arrives whole, so the update object sits under
 * `params.update`; a recorder that read the top level counted turns only, and silently dropped
 * every tool call, the context window and the cost.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useHarnessStore } from '@features/chat/stores/harness';
import { useUsageStore } from '@features/agent/stores/usage';

vi.mock('@platform/api/acp', () => ({
  acpAnswerPermission: vi.fn(async () => undefined),
  acpCancel: vi.fn(async () => undefined),
  acpClose: vi.fn(async () => undefined),
  acpOpen: vi.fn(async () => ({ sessionId: 's1', agent: { agentInfo: { name: 'Fake' } } })),
  acpPrompt: vi.fn(async () => undefined),
  onAcpSession: vi.fn(async () => () => {}),
}));

const TAB = 'tab-usage';
const SESSION = 's1';

/** A notification exactly as the backend forwards it: the whole JSON-RPC message. */
const notification = (update: Record<string, unknown>) => ({
  kind: 'update',
  sessionId: SESSION,
  payload: { jsonrpc: '2.0', method: 'session/update', params: { sessionId: SESSION, update } },
});

const row = () => useUsageStore.getState().acp['Claude Code'];

beforeEach(async () => {
  useUsageStore.setState({ records: [], acp: {} });
  useHarnessStore.setState({ byTab: {} });
  await useHarnessStore.getState().open(TAB, 'Claude Code', '');
});

describe('harness usage recording', () => {
  it('counts turns, tool calls, context and cost from the protocol updates', () => {
    const store = useHarnessStore.getState();
    store.applyEvent(notification({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'Run the tests' }) as never);
    store.applyEvent(notification({
      sessionUpdate: 'usage_update', used: 12_000, size: 200_000,
      cost: { amount: 0.0042, currency: 'USD' },
    }) as never);
    store.applyEvent({ kind: 'stop', sessionId: SESSION, payload: { stopReason: 'end_turn' } } as never);

    expect(row()).toMatchObject({
      source: 'Claude Code', turns: 1, toolCalls: 1,
      contextUsed: 12_000, contextSize: 200_000, cost: 0.0042, currency: 'USD',
    });
  });

  it('accepts a payload that already is the params object', () => {
    useHarnessStore.getState().applyEvent({
      kind: 'update',
      sessionId: SESSION,
      payload: { sessionId: SESSION, update: { sessionUpdate: 'tool_call', toolCallId: 'c2' } },
    } as never);

    expect(row()?.toolCalls).toBe(1);
  });
});
