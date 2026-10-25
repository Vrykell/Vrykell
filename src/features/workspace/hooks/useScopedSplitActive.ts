import { scopedPaneStores, type PaneWorkspaceScope } from '../stores/scopedPanes';
import { workspacePaneCells } from '../model/workspaceResources';

export function useScopedSplitActive(scope: PaneWorkspaceScope) {
  return scopedPaneStores[scope](state => state.choosingSplit || !!state.layout && workspacePaneCells(state.layout).length > 1);
}
