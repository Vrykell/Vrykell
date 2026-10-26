import { useMemo } from 'react';
import { useWorkspaceStore } from '../stores/workspace';
import { scopedPaneStores, type PaneWorkspaceScope } from '../stores/scopedPanes';
import { workspacePaneCells } from '../model/workspaceResources';

/** Resources assigned to main layouts cannot be borrowed by an auxiliary surface. */
export function usePlacedWorkspaceResourceIds(scope: PaneWorkspaceScope): string[] {
  const tabs = useWorkspaceStore(state => state.tabs);
  const layout = scopedPaneStores[scope](state => state.layout);
  const choosingSplit = scopedPaneStores[scope](state => state.choosingSplit);
  return useMemo(() => [...new Set([
    ...tabs.flatMap(tab => tab.kind === 'workspace' && tab.paneLayout ? workspacePaneCells(tab.paneLayout).map(cell => cell.resourceId) : []),
    ...(layout && (choosingSplit || workspacePaneCells(layout).length > 1) ? workspacePaneCells(layout).map(cell => cell.resourceId) : []),
  ])], [tabs, layout, choosingSplit]);
}
