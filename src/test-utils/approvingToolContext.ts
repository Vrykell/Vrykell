/**
 * Test helper: the authorization seams stubbed to allow every call.
 *
 * Tool tests care about their own logic, not the policy: `approveAllToolCalls()` makes the
 * backend authorizer answer "allow" with a fixed lease (so gated commands receive one) and
 * `approvingToolContext()` also gives the gate an interactive context. Tests that exercise the
 * approval flow itself install their own stubs and drive `resolveApproval` instead.
 */
import {
  resolveApproval,
  setToolApprover,
  setToolAuthorizer,
  levelOf,
  type ToolContext,
} from '@features/agent/stores/permissions';

export const TEST_LEASE = 'test-lease';

/** Deny what the mirror marks as denied; allow the rest so tools exercise their own logic. */
export function approveAllToolCalls(): void {
  setToolAuthorizer(async ({ tool }) =>
    levelOf(tool) === 'deny'
      ? { decision: 'deny', reason: 'policy.denied' }
      : { decision: 'allow', lease: TEST_LEASE });
  setToolApprover(async () => ({ decision: 'allow', lease: TEST_LEASE }));
}

export function approvingToolContext(extra: Partial<ToolContext> = {}): ToolContext {
  approveAllToolCalls();
  return {
    tabId: 'test-tab',
    ...extra,
    setToolState: (toolCallId, state, detail) => {
      extra.setToolState?.(toolCallId, state, detail);
      if (state === 'approval-pending') queueMicrotask(() => resolveApproval(toolCallId, 'once'));
    },
  };
}
