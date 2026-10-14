/**
 * sensitiveActions — durable side effects inside an otherwise safe tool.
 *
 * Rewriting long-term memory, creating a subagent prompt or arming a schedule outlives the
 * turn, and the first two feed every later system prompt. A prompt-injected page or file
 * could therefore plant instructions that keep running after the conversation ends. These
 * actions are asked per call, exactly like dangerous commands, even when the tool level is
 * "allow" or the user granted a session approval.
 *
 * Reasons are i18n keys; the approval card renders the translated text.
 */
import { t, type I18nKey } from '@i18n';

interface ActionRule {
  tool: string;
  /** Tool action that needs a per-call decision; '*' covers the whole tool. */
  action: string;
  reason: I18nKey;
}

const RULES: ActionRule[] = [
  { tool: 'memory', action: 'update', reason: 'Rewrites long-term memory (injected into every later request)' },
  { tool: 'memory', action: 'append', reason: 'Appends to long-term memory (injected into every later request)' },
  { tool: 'subagent', action: 'create', reason: 'Creates a subagent prompt that is reused later' },
  { tool: 'subagent', action: 'remove', reason: 'Removes a subagent definition' },
  { tool: 'schedule', action: 'create', reason: 'Arms a recurring task that runs without asking again' },
  { tool: 'schedule', action: 'toggle', reason: 'Starts or stops a recurring task' },
  { tool: 'schedule', action: 'remove', reason: 'Removes a recurring task' },
];

/** Reason for a per-call approval, or null when the action is not durable. */
export function sensitiveActionReason(
  toolName: string,
  input: Record<string, unknown>,
): string | null {
  const action = typeof input.action === 'string' ? input.action : '*';
  for (const rule of RULES) {
    if (rule.tool !== toolName) continue;
    if (rule.action !== '*' && rule.action !== action) continue;
    return t(rule.reason);
  }
  return null;
}
