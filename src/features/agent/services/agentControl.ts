/**
 * agentControl — set of panes the agent currently controls (reference counted).
 *
 * Backs the isAgentInControl slot in inputVisibility: while the agent runs commands in
 * a pane through run_command, that pane keeps its input bar visible (long commands do
 * not hide it). Reference counting stops nested or concurrent tool calls from releasing
 * the control early.
 */

const counts = new Map<string, number>();
const listeners = new Set<() => void>();

/** Registry of command block ids started by the agent (source of truth for the agent badge).
 *  The block stream's onBlocksChanged replaces the whole array (projectBlock rebuilds it), which
 *  wipes patches applied through updateBlock, so the mark persists here and is looked up by id
 *  during projection. */
const markedBlocks = new Set<string>();

/** toolCallId → blockId: when AiBlock embeds a command output block in the reply (under the
 *  run_command node), it looks up the live block by toolCallId. Session-level in-memory map,
 *  lost on restart — embedded cards then fall back to rendering the output text captured in
 *  the tool result. */
const toolCallBlocks = new Map<string, string>();

function emit() {
  for (const fn of listeners) fn();
}

export const agentControl = {
  /** Enter control (nestable; every acquire must pair with a release). */
  acquire(paneId: string): void {
    counts.set(paneId, (counts.get(paneId) ?? 0) + 1);
    emit();
  },
  release(paneId: string): void {
    const n = (counts.get(paneId) ?? 0) - 1;
    if (n <= 0) counts.delete(paneId);
    else counts.set(paneId, n);
    emit();
  },
  isControlled(paneId: string): boolean {
    return (counts.get(paneId) ?? 0) > 0;
  },
  /** UI subscription (for useSyncExternalStore). */
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** Register a command block started by the agent (source of truth for the agent badge; session-level, not persisted). */
  markBlock(blockId: string): void {
    markedBlocks.add(blockId);
  },
  hasBlock(blockId: string): boolean {
    return markedBlocks.has(blockId);
  },
  /** Record the tool call → command block mapping (used for embedded rendering). */
  linkToolCall(toolCallId: string, blockId: string): void {
    toolCallBlocks.set(toolCallId, blockId);
  },
  blockForToolCall(toolCallId: string): string | undefined {
    return toolCallBlocks.get(toolCallId);
  },
};
