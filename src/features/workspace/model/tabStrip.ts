import type { TabHandle } from '@ui/layout/tabHandle';
import { orderedWorkspaceIds } from '../stores/navigation';

/** Uniform shape returned by every strip provider. */
export interface WorkspaceTabStrip {
  handles: TabHandle[];
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onMove: (id: string, over: string, after: boolean) => void;
}

/**
 * Apply a saved strip order to projected rows, dropping identifiers whose content no longer
 * exists and appending newly opened rows in projection order.
 */
export function orderProjected<T extends { handle: { id: string } }>(targets: T[], order: string[]): T[] {
  const byId = new Map(targets.map(target => [target.handle.id, target]));
  // `orderedWorkspaceIds` only returns ids present in `targets`, so every lookup succeeds.
  return orderedWorkspaceIds(targets.map(target => target.handle.id), order).map(id => byId.get(id)!);
}
