import { useWorkbenchStore } from '../stores/workbench';
import type { WorkspaceScope } from '../model/workbench';
import { workspaceAreaStores } from '../stores/paneWorkspace';

export function useWorkspaceContainer(scope: WorkspaceScope, id?: string) {
  return useWorkbenchStore(state => state.snapshot.tabs.find(tab => tab.scope === scope && tab.id === (id ?? state.snapshot.selected[scope])));
}

export function useWorkspacePaneControls(scope: WorkspaceScope) {
  return workspaceAreaStores[scope]();
}

export function useWorkspacePlacementActive(scope: WorkspaceScope) {
  return workspaceAreaStores[scope](state => !!(state.pendingMergeTab || state.choosingSplit));
}
