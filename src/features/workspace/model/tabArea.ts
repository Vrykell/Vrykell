import type { WorkspaceArea } from '../stores/navigation';
import type { TabKind } from '../stores/workspace';

/**
 * Single routing table from a tab kind to its functional workspace.
 *
 * The exhaustive record makes a new `TabKind` a compile error until it is assigned an area,
 * instead of silently falling into the terminal strip.
 */
export const TAB_KIND_AREA: Readonly<Record<TabKind, WorkspaceArea>> = Object.freeze({
  session: 'terminal',
  history: 'terminal',
  start: 'terminal',
  editor: 'code',
  'git-diff': 'code',
  'start-code': 'code',
  harness: 'ai',
  usage: 'ai',
  'ai-history': 'ai',
  'start-ai': 'ai',
});

/**
 * Resolve a persisted kind without trusting it.
 *
 * Unknown kinds can only come from a corrupt history record; the terminal strip keeps them
 * visible so the user can close or inspect the session instead of losing it.
 */
export function workspaceAreaForKind(kind: string): WorkspaceArea {
  return (TAB_KIND_AREA as Readonly<Record<string, WorkspaceArea>>)[kind] ?? 'terminal';
}
