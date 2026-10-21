/**
 * toolPolicy — IPC surface for the authorization decisions Rust owns.
 *
 * The level table, the danger / credential heuristics and the per-call leases live in the
 * backend (`src-tauri/src/agent/permissions.rs`). The webview asks for a decision, shows its
 * approval card only when the answer is "ask", and forwards the lease to the gated command.
 */
import { invoke } from '@platform/diagnostics';
import type { ToolLevel } from '@features/agent/stores/permissions';

export interface ToolDecision {
  decision: 'allow' | 'ask' | 'deny';
  /** Reason code (danger.*, path.*, durable.*, policy.*) when a heuristic decided. */
  reason?: string;
  /** Single-use token the gated command must present. */
  lease?: string;
  /**
   * Command shape an `ask` may be approved for the rest of the session ("npm run"). Rust derives
   * it, so the label on the card and the grant it makes cannot disagree.
   */
  shape?: string | null;
}

export interface AuthorizeRequest {
  tool: string;
  conversationId?: string;
  /** Gated command this call runs (read_file_text, fs_search, ...); defaults to the tool name. */
  command?: string;
  args: Record<string, unknown>;
  shell?: string | null;
  mode?: string;
  /** Localized line for the native confirmation; the tool, reason code and args come from Rust. */
  reasonHint?: string;
  /** How long a native confirmation waits for an answer before denying the call. */
  timeoutSecs?: number;
}

export const authorizeToolCall = (request: AuthorizeRequest) =>
  invoke<ToolDecision>('authorize_tool_call', {
    request: { ...request, shell: request.shell ?? null, mode: request.mode ?? 'standard' },
  });

export const approveToolCall = (
  tool: string,
  command: string | undefined,
  args: Record<string, unknown>,
  scope: 'once' | 'session' | 'shape',
  conversationId?: string,
) => invoke<ToolDecision>('approve_tool_call', { tool, command: command ?? null, args, scope, conversationId: conversationId ?? null });

export const loadToolPolicy = () => invoke<Record<string, ToolLevel>>('tool_policy_get');

export const setToolPolicyLevel = (tool: string, level: ToolLevel) =>
  invoke<void>('tool_policy_set_level', { tool, level });

export const clearToolSessionGrants = (conversationId?: string) =>
  invoke<void>('tool_policy_clear_session_grants', { conversationId: conversationId ?? null });
