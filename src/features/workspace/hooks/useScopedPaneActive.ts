import { scopedPaneStores, type PaneWorkspaceScope } from '../stores/scopedPanes';

export function useScopedPaneActive(scope: PaneWorkspaceScope) {
  return scopedPaneStores[scope](state => state.choosingSplit || !!state.pendingMergeTab || !!state.layout);
}
