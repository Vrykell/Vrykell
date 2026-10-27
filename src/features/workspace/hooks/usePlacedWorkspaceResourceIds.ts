import { useWorkbenchStore } from '../stores/workbench';
import { panesOf } from '../model/workbench';
import type { PaneWorkspaceScope } from '../stores/scopedPanes';

/** Every inactive tab retains ownership too, so auxiliary views cannot borrow its host. */
export function usePlacedWorkspaceResourceIds(scope: PaneWorkspaceScope): string[] {
  const tabs = useWorkbenchStore(state => state.snapshot.tabs);
  return [...new Set(tabs.filter(tab => tab.scope === 'unified' || tab.scope === scope && panesOf(tab).length > 1).flatMap(panesOf).map(pane => pane.resourceId))];
}
