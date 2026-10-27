/**
 * killForeground — terminates the PTY foreground application (used by the stop button).
 *
 * The escalation policy (SIGTERM first, a second press within the window escalates to
 * SIGKILL) lives in the backend `pty_kill_foreground` command, so its state survives
 * reloads across windows; this module only issues the call and returns the level.
 */

import { invoke } from '@platform/diagnostics';

export type KillLevel = 'term' | 'kill';

/** Escalation window (ms) — matches the backend ESCALATE_WINDOW; used only to reset button state. */
export const ESCALATE_WINDOW_MS = 3000;

/**
 * Terminates the foreground application of a session and returns the level used (term/kill).
 * Throws when the backend refuses (the foreground is the shell itself, platform unsupported,
 * ...); the caller owns the user-facing feedback.
 */
export async function killForeground(sessionId: string): Promise<KillLevel> {
  return invoke<KillLevel>('pty_kill_foreground', { id: sessionId });
}
