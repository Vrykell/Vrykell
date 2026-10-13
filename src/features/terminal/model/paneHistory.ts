import type { Scene } from '@features/terminal/services/pipeline/sessionController';
import type { TerminalSpec } from '@features/workspace/model/windowLayout';

/**
 * Whether a pane renders its inline AI chat history above the terminal.
 *
 * A local pane in the classic scene keeps the conversation visible while its
 * terminal is usable. An SSH pane's classic scene *is* its connection and
 * authentication surface (`TerminalPanel` treats every non-block scene as
 * interactive), so the surface owns the pane and the history stays out of it.
 */
export function showsPaneChatHistory(scene: Scene, kind: TerminalSpec['kind']): boolean {
  return scene === 'classic' && kind !== 'ssh';
}
