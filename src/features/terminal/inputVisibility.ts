import { t } from '@i18n';
/**
 * inputVisibility — decides when the composer is visible (see documentation §7).
 */

export interface InputVisibilityContext {
  isReadOnly: boolean;
  isAltScreenActive: boolean;
  isLongRunning: boolean;
  isAgentInControl: boolean;
  isAgentTaggedIn: boolean;
}

/**
 * Whether the composer is visible.
 *
 * Priority (simplified §7 version of the full condition set):
 *   1. read-only → hidden
 *   2. full-screen TUI active → hidden
 *   3. long-running command (not agent-controlled/tagged) → hidden
 *   4. default → visible
 */
export function isInputBoxVisible(ctx: InputVisibilityContext): boolean {
  if (ctx.isReadOnly) return false;

  if (ctx.isAltScreenActive) return false;

  if (ctx.isLongRunning && !ctx.isAgentInControl && !ctx.isAgentTaggedIn) {
    return false;
  }

  return true;
}

/** Label for a foreground command while the composer is hidden. */
export function getLongRunningHint(command: string): string {
  const label = command.length > 40 ? command.slice(0, 37) + '...' : command;
  return t('{{command}} running', { command: label });
}
