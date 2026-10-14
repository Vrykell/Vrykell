/**
 * Test helper: a tool context that approves every approval request as soon as the bridge
 * registers it, so tool tests exercise their own logic instead of the approval flow.
 *
 * The decision is queued as a microtask: gate() writes the approval-pending state before it
 * awaits the decision, so a synchronous resolve would arrive before the resolver exists.
 */
import { resolveApproval, type ToolContext } from '@features/agent/stores/permissions';

export function approvingToolContext(extra: Partial<ToolContext> = {}): ToolContext {
  return {
    tabId: 'test-tab',
    ...extra,
    setToolState: (toolCallId, state, detail) => {
      extra.setToolState?.(toolCallId, state, detail);
      if (state === 'approval-pending') queueMicrotask(() => resolveApproval(toolCallId, 'once'));
    },
  };
}
